interface Estado {
	ronda: number;
	fase: string;
	indice: number;
	claveIdx: number;
	extra: number;
	bytes: number[];
}

interface Respuesta {
	llave: number[];
	bloques: number;
	estados: Estado[];
	cifrado: number[];
	descifrado: number[];
	error?: string;
}

// Utilidades DOM
const el = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;
const q = <T extends HTMLElement>(
	parent: HTMLElement | Document,
	selector: string,
) => parent.querySelector(selector) as T;
const qAll = (parent: HTMLElement | Document, selector: string) =>
	Array.from(parent.querySelectorAll(selector)) as HTMLElement[];
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const visible = (n: number) =>
	n >= 33 && n < 127 ? String.fromCharCode(n) : n === 32 ? "␣" : "·";

const ETIQUETAS_FASE: Record<string, string> = {
	INICIAL: "Estado inicial",
	XOR_CLAVE: "XOR con la clave",
	XOR_ENCADENADO: "XOR encadenado",
	SUSTITUCION: "Sustitución",
	ROTACION: "Rotación de bits",
	TRANSPOSICION: "Transposición",
};

// Variables de estado
let estados: Estado[] = [];
let respuestaGlobal: Respuesta | null = null;
let llave: number[] = [];
let pasoActual = 0;
let pausado = false;
let temporizador: ReturnType<typeof setTimeout> | undefined;

// Guardar longitud original para saber qué partes son relleno
let lenTextoOriginal = 0;
let lenClaveOriginal = 0;

// Nodos UI (Pantallas y Vistas)
const secHome = el("home");
const secAnim = el("animation");
const viewIntro = el("view-intro");
const viewGrid = el("view-grid");
const viewResult = el("view-result");

// Nodos UI (Formulario y Textos)
const form = el<HTMLFormElement>("inputs");
const inTexto = el<HTMLInputElement>("texto");
const inClave = el<HTMLInputElement>("clave");
const introText = el("intro-text");
const resCifrado = el("res-cifrado");
const resDescifrado = el("res-descifrado");

// Nodos UI (Grid y Animación)
const tituloFase = el("fase");
const subtituloChar = el("char-n");
const textoOperacion = q(document.body, ".text-operacion");
const contenedorBloque = el("bloque-id");
const contenedorClave = q(el("clave-id"), ".fila-bloque");

// Controles
const btnSaltar = q(document.body, ".btn-saltar");
const btnPausar = q(document.body, ".btn-pausar");
const btnsNav = qAll(document.body, ".btn-nav");
const btnReiniciar = el("btn-reiniciar");
const inVelocidad = el<HTMLInputElement>("vel");

// Preparar el HTML
function prepararUI() {
	const colBloque = q(contenedorBloque, ".col");
	if (contenedorBloque.children.length === 1) {
		for (let i = 1; i < 16; i++)
			contenedorBloque.appendChild(colBloque.cloneNode(true));
	}
	const colClave = q(contenedorClave, ".col");
	if (contenedorClave.children.length === 1) {
		for (let i = 1; i < 16; i++)
			contenedorClave.appendChild(colClave.cloneNode(true));
	}
}

// Pintar celdas (Añadido lenOriginal para pintar el relleno)
function pintarFila(
	contenedor: HTMLElement,
	bytes: number[],
	indiceActivo: number,
	lenOriginal: number,
) {
	const columnas = qAll(contenedor, ".col");
	bytes.forEach((b, i) => {
		if (!columnas[i]) return;
		const charEl = q(columnas[i], ".char");
		const hexEl = q(columnas[i], ".char-hex");
		const inCol = q(columnas[i], ".in-col");
		const numEl = q(columnas[i], ".num");

		charEl.textContent = visible(b);
		hexEl.textContent = hex2(b);
		if (numEl) numEl.textContent = i.toString().padStart(2, "0");

		// Marcar como activo
		if (i === indiceActivo) {
			inCol.classList.add("active");
		} else {
			inCol.classList.remove("active");
		}

		// Marcar como relleno (si supera la longitud original del texto/clave)
		if (i >= lenOriginal) {
			inCol.classList.add("relleno");
		} else {
			inCol.classList.remove("relleno");
		}
	});
}

function describirOperacion(e: Estado, estadoAnterior?: Estado): string {
	if (!estadoAnterior)
		return "Texto cargado en memoria, iniciando algoritmo...";
	const antes = estadoAnterior.bytes[e.indice];
	const ahora = e.bytes[e.indice];
	const claveByte = llave[e.claveIdx] ?? 0;

	switch (e.fase) {
		case "XOR_CLAVE":
			return `${hex2(antes)} ⊕ ${hex2(claveByte)} = ${hex2(ahora)}`;
		case "XOR_ENCADENADO":
			return `${hex2(antes)} ⊕ ${hex2(e.bytes[e.extra])} = ${hex2(ahora)}`;
		case "SUSTITUCION":
			return `Sustitución: ${hex2(antes)} → ${hex2(ahora)}`;
		case "ROTACION":
			return `Rotación: ${hex2(antes)} ↺ ${e.extra} = ${hex2(ahora)}`;
		case "TRANSPOSICION":
			return `Pos ${e.indice} ⇄ Pos ${e.extra}`;
		default:
			return "";
	}
}

// Orquestador Principal de la Animación Grid
function mostrarPaso(idx: number) {
	if (idx >= estados.length) {
		terminarAnimacion();
		return;
	}

	pasoActual = Math.max(0, idx);
	const e = estados[pasoActual];
	const anterior = pasoActual > 0 ? estados[pasoActual - 1] : undefined;

	tituloFase.textContent =
		e.fase === "INICIAL"
			? "Cargando Bloque de Texto"
			: `Ronda ${e.ronda + 1} de 5 - ${ETIQUETAS_FASE[e.fase] || e.fase}`;

	subtituloChar.textContent = (e.indice + 1).toString();
	textoOperacion.textContent = describirOperacion(e, anterior);

	const llaveCompleta = Array(16)
		.fill(0)
		.map((_, i) => llave[i % llave.length] || 0);

	// Pasamos lenTextoOriginal y lenClaveOriginal para generar las rayas
	pintarFila(contenedorBloque, e.bytes, e.indice, lenTextoOriginal);
	pintarFila(
		contenedorClave,
		llaveCompleta,
		e.claveIdx >= 0 ? e.claveIdx : -1,
		lenClaveOriginal,
	);

	programarSiguiente();
}

function programarSiguiente() {
	clearTimeout(temporizador);
	if (pausado || pasoActual >= estados.length) return;

	let retardo = Math.max(50, 1000 - Number(inVelocidad.value) * 115);

	// Si estamos en el paso 0, le damos 2.5 segundos extra para que el usuario pueda ver bien
	// el bloque inicial en la cuadrícula antes de empezar a mutar las letras
	if (pasoActual === 0) {
		retardo += 2500;
	}

	temporizador = setTimeout(() => mostrarPaso(pasoActual + 1), retardo);
}

function alternarPausa() {
	pausado = !pausado;
	btnPausar.textContent = pausado ? "CONTINUAR" : "PAUSAR";
	programarSiguiente();
}

// Cambia a la pantalla Final
function terminarAnimacion() {
	clearTimeout(temporizador);
	viewGrid.classList.add("hidden");
	viewResult.classList.remove("hidden");

	if (respuestaGlobal) {
		resCifrado.textContent = respuestaGlobal.cifrado.map(hex2).join(" ");
		const decoder = new TextDecoder("utf-8");
		resDescifrado.textContent = decoder.decode(
			new Uint8Array(respuestaGlobal.descifrado),
		);
	}
}

// Evento Inicial (Submit)
form.addEventListener("submit", async (e) => {
	e.preventDefault();
	const texto = inTexto.value.trim();
	const clave = inClave.value.trim();
	if (!texto || !clave) return alert("Ingresa texto y clave");

	const btn = q<HTMLButtonElement>(form, "button[type='submit']");
	btn.disabled = true;

	try {
		const res = await fetch("/api/encriptar", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ texto, clave }),
		});

		const data: Respuesta = await res.json();
		if (!res.ok) throw new Error(data.error || "Error al encriptar");

		respuestaGlobal = data;
		estados = data.estados;
		llave = data.llave;
		pasoActual = 0;
		pausado = false;
		btnPausar.textContent = "PAUSAR";

		// Calcular y guardar el tamaño original en bytes (UTF-8)
		const codificador = new TextEncoder();
		lenTextoOriginal = codificador.encode(texto).length;
		lenClaveOriginal = codificador.encode(clave).length;

		// 1. Ocultar Home, Preparar Vistas
		secHome.classList.add("hidden");
		secAnim.classList.remove("hidden");

		viewGrid.classList.add("hidden");
		viewResult.classList.add("hidden");

		// 2. Mostrar Escena Intro
		introText.textContent = texto;
		viewIntro.classList.remove("hidden");

		prepararUI();

		// 3. Tras 2.5s, pasar a la Cuadrícula
		setTimeout(() => {
			viewIntro.classList.add("hidden");
			viewGrid.classList.remove("hidden");
			mostrarPaso(0);
		}, 2500);
	} catch (err: any) {
		alert(err.message);
	} finally {
		btn.disabled = false;
	}
});

// Controles y Reinicio
btnSaltar.addEventListener("click", () => {
	pausado = true;
	terminarAnimacion();
});
btnPausar.addEventListener("click", alternarPausa);
btnsNav[0].addEventListener("click", () => {
	pausado = true;
	mostrarPaso(pasoActual - 1);
});
btnsNav[1].addEventListener("click", () => {
	pausado = true;
	mostrarPaso(pasoActual + 1);
});
inVelocidad.addEventListener("input", programarSiguiente);

btnReiniciar.addEventListener("click", () => {
	secAnim.classList.add("hidden");
	secHome.classList.remove("hidden");
	inTexto.value = "";
	inTexto.focus();
});
