import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

const PUERTO = Number(process.env.PORT) || 3000;
// Al compilar, este archivo queda en "dist/server.js"
// Subir un nivel ("..") llega exactamente a la raíz del proyecto
const RAIZ = path.resolve(__dirname, "..");
const PUBLICO = path.join(RAIZ, "public");
const FUENTE = path.join(RAIZ, "cpp", "cifrador.cpp");
const EJECUTABLE = path.join(
	RAIZ,
	"cpp",
	process.platform === "win32" ? "cifrador.exe" : "cifrador",
);

const MAX_TEXTO_BYTES = 100;
const MAX_CLAVE_BYTES = 16;

interface Estado {
	ronda: number;
	fase: string;
	indice: number;
	claveIdx: number;
	extra: number;
	bytes: number[];
}

interface Resultado {
	llave: number[];
	bloques: number;
	estados: Estado[];
	cifrado: number[];
	descifrado: number[];
}

// ---------- C++ ----------

function compilar(): Promise<void> {
	return new Promise((resolve, reject) => {
		exec(`g++ -O2 -o "${EJECUTABLE}" "${FUENTE}"`, (error, _stdout, stderr) => {
			if (error)
				reject(
					new Error(
						`No se pudo compilar el C++ (¿está instalado g++?):\n${stderr}`,
					),
				);
			else resolve();
		});
	});
}

function ejecutarCpp(textoHex: string, claveHex: string): Promise<string> {
	return new Promise((resolve, reject) => {
		// Los argumentos son solo hexadecimal (validado antes), así que no hay riesgo de inyección
		exec(
			`"${EJECUTABLE}" ${textoHex} ${claveHex}`,
			{ maxBuffer: 5 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) reject(new Error(stderr || error.message));
				else resolve(stdout);
			},
		);
	});
}

const hexABytes = (hex: string): number[] =>
	(hex.match(/.{1,2}/g) ?? []).map((h) => parseInt(h, 16));

function interpretarSalida(salida: string): Resultado {
	const r: Resultado = {
		llave: [],
		bloques: 1,
		estados: [],
		cifrado: [],
		descifrado: [],
	};

	for (const linea of salida.split(/\r?\n/)) {
		const partes = linea.trim().split("|");
		switch (partes[0]) {
			case "LLAVE":
				r.llave = hexABytes(partes[1]);
				break;
			case "BLOQUES":
				r.bloques = Number(partes[1]);
				break;
			case "E":
				r.estados.push({
					ronda: Number(partes[1]),
					fase: partes[2],
					indice: Number(partes[3]),
					claveIdx: Number(partes[4]),
					extra: Number(partes[5]),
					bytes: hexABytes(partes[6]),
				});
				break;
			case "CIFRADO":
				r.cifrado = hexABytes(partes[1]);
				break;
			case "DESCIFRADO":
				r.descifrado = hexABytes(partes[1]);
				break;
		}
	}
	return r;
}

// ---------- HTTP ----------

const TIPOS: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
};

function responderJson(
	res: http.ServerResponse,
	codigo: number,
	datos: unknown,
): void {
	res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(datos));
}

function leerCuerpo(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let cuerpo = "";
		req.on("data", (trozo) => {
			cuerpo += trozo;
			if (cuerpo.length > 10_000) {
				reject(new Error("Cuerpo demasiado grande"));
				req.destroy();
			}
		});
		req.on("end", () => resolve(cuerpo));
		req.on("error", reject);
	});
}

async function manejarEncriptar(
	req: http.IncomingMessage,
	res: http.ServerResponse,
): Promise<void> {
	try {
		const { texto, clave } = JSON.parse(await leerCuerpo(req)) as {
			texto?: string;
			clave?: string;
		};

		if (
			typeof texto !== "string" ||
			typeof clave !== "string" ||
			!texto ||
			!clave
		) {
			return responderJson(res, 400, {
				error: "Escribe un texto y una clave.",
			});
		}

		const textoBuf = Buffer.from(texto, "utf8");
		const claveBuf = Buffer.from(clave, "utf8");

		if (textoBuf.length > MAX_TEXTO_BYTES) {
			return responderJson(res, 400, {
				error: `El texto ocupa ${textoBuf.length} bytes en UTF-8; el máximo es ${MAX_TEXTO_BYTES}.`,
			});
		}
		if (claveBuf.length > MAX_CLAVE_BYTES) {
			return responderJson(res, 400, {
				error: `La clave ocupa ${claveBuf.length} bytes en UTF-8; el máximo es ${MAX_CLAVE_BYTES}.`,
			});
		}

		const salida = await ejecutarCpp(
			textoBuf.toString("hex"),
			claveBuf.toString("hex"),
		);
		responderJson(res, 200, interpretarSalida(salida));
	} catch (e) {
		responderJson(res, 500, { error: (e as Error).message });
	}
}

function servirEstatico(
	req: http.IncomingMessage,
	res: http.ServerResponse,
): void {
	const url = (req.url ?? "/").split("?")[0];
	const relativa = url === "/" ? "index.html" : url.replace(/^\/+/, "");
	const archivo = path.resolve(PUBLICO, relativa);

	// Evita salir de la carpeta public (path traversal)
	if (!archivo.startsWith(PUBLICO + path.sep)) {
		res.writeHead(403);
		return void res.end("Prohibido");
	}

	fs.readFile(archivo, (err, datos) => {
		if (err) {
			res.writeHead(404);
			return void res.end("No encontrado");
		}
		res.writeHead(200, {
			"Content-Type":
				TIPOS[path.extname(archivo)] ?? "application/octet-stream",
		});
		res.end(datos);
	});
}

async function main(): Promise<void> {
	console.log("Compilando cifrador.cpp ...");
	await compilar();

	http
		.createServer((req, res) => {
			if (req.method === "POST" && req.url === "/api/encriptar")
				void manejarEncriptar(req, res);
			else if (req.method === "GET") servirEstatico(req, res);
			else {
				res.writeHead(405);
				res.end();
			}
		})
		.listen(PUERTO, () => console.log(`Abre http://localhost:${PUERTO}`));
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
