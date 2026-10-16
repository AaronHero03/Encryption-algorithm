#include <iostream>
#include <string>
#include <cstdio>
#include <cstdlib>

using namespace std;

bool modoVisual = false;

// ---------- Utilidades hexadecimales ----------

string aHex(const string& s) {
    string r;
    char buf[3];
    for (size_t i = 0; i < s.length(); i++) {
        snprintf(buf, sizeof(buf), "%02X", (unsigned char)s[i]);
        r += buf;
    }
    return r;
}

string desdeHex(const string& h) {
    string r;
    for (size_t i = 0; i + 1 < h.length(); i += 2) {
        r += (char)strtol(h.substr(i, 2).c_str(), NULL, 16);
    }
    return r;
}

void imprimirEstado(int ronda, string fase, int indice, int claveIdx, int extra,
                    const string& texto, int inicioBloque) {
    if (!modoVisual || inicioBloque != 0) return;
    int tamanoBloque = 16;
    printf("E|%d|%s|%d|%d|%d|", ronda, fase.c_str(), indice, claveIdx, extra);
    for (int i = 0; i < tamanoBloque; i++) {
        printf("%02X", (unsigned char)texto[inicioBloque + i]);
    }
    printf("\n");
    fflush(stdout);
}

string derivarLlave(string claveOriginal) {
    string llaveFija = "";
    int tamanoObjetivo = 16;

    for (int i = 0; i < tamanoObjetivo; i++) {
        llaveFija += claveOriginal[i % claveOriginal.length()];
    }

    return llaveFija;
}

string encriptar(string texto, string clave){
  // Debe ser un cuadrado perfecto para funcionar
  int tamanoBloque = 16;

  clave = derivarLlave(clave);

  // Asegurar que el tamaño del texto sea multiplo del tamaño del bloque mediante el estandar PKCS#7
  int bytesFaltantes = tamanoBloque - (texto.length() % tamanoBloque);
  for (int i = 0; i < bytesFaltantes; i++) {
      texto += (char)bytesFaltantes;
  }

  // Procesamiento por bloques
  for(int i = 0; i < (int)texto.length(); i+=tamanoBloque){
    int numRondas = 5;
    for(int ronda = 0; ronda < numRondas; ronda++){
      if (ronda == 0) imprimirEstado(ronda, "INICIAL", -1, -1, -1, texto, i);

      // XOR con la clave
      for(int j = 0; j < tamanoBloque; j++){
        texto[i+j] = (unsigned char)texto[i+j] ^ (unsigned char)clave[j];
        imprimirEstado(ronda, "XOR_CLAVE", j, j, -1, texto, i);
      }

      // Otra capa de XOR para que los bits encriptados afecten al resto de bits, evitando patrones
      for(int j = 1; j < tamanoBloque; j++){
          texto[i+j] = (unsigned char)texto[i+j] ^ (unsigned char)texto[i+j-1];
          imprimirEstado(ronda, "XOR_ENCADENADO", j, -1, j - 1, texto, i);
      }

      // Substitucion
      for(int j = 0; j < tamanoBloque; j++){
        int idxClave = (j+1)%clave.length();
        texto[i+j] = (unsigned char)texto[i+j] + (unsigned char)clave[idxClave];
        imprimirEstado(ronda, "SUSTITUCION", j, idxClave, -1, texto, i);
      }

      // Bit shifting
      for(int j = 0; j < tamanoBloque; j++){
        int idxClave = (j+3)%clave.length();
        // (unsigned char) evita rotaciones negativas con bytes >= 128 (UTF-8)
        int rotacion = ((unsigned char)clave[idxClave] % 7) + 1;

        texto[i+j] = ((unsigned char)texto[i+j] << rotacion) | ((unsigned char)texto[i+j] >> (8 -rotacion));
        imprimirEstado(ronda, "ROTACION", j, idxClave, rotacion, texto, i);
      }

      // Transpocision
      int dimension = 4;

      for(int fila = 0; fila < dimension; fila++){
        for(int col = fila + 1; col < dimension; col++){

            int indice1 = i + (fila * dimension + col);
            int indice2 = i + (col * dimension + fila);

            swap(texto[indice1], texto[indice2]);
            imprimirEstado(ronda, "TRANSPOSICION", indice1 - i, -1, indice2 - i, texto, i);
        }
      }
    }
  }

  return texto;
}

string desencriptar(string texto, string clave){

  int tamanoBloque = 16;

  clave = derivarLlave(clave);

  // Procesamiento por bloques
  for(int i = 0; i < (int)texto.length(); i+=tamanoBloque){

    int numRondas = 5;
    for(int ronda = 0; ronda < numRondas; ronda++){

      // La transpocision se revierte directamente a si misma
      int dimension = 4;

      for(int fila = 0; fila < dimension; fila++){
        for(int col = fila + 1; col < dimension; col++){

            int indice1 = i + (fila * dimension + col);
            int indice2 = i + (col * dimension + fila);

            swap(texto[indice1], texto[indice2]);
        }
      }

      // Invertir el bit shifting de direccion
      for(int j = 0; j < tamanoBloque; j++){

        int rotacion = ((unsigned char)clave[(j+3)%clave.length()] % 7) + 1;

        texto[i+j] = ((unsigned char)texto[i+j] >> rotacion) | ((unsigned char)texto[i+j] << (8 -rotacion));
      }

      // Substitucion con el signo cambiado
      for(int j = 0; j < tamanoBloque; j++){
        texto[i+j] = (unsigned char)texto[i+j] - (unsigned char)clave[(j+1)%clave.length()];
      }

      for(int j = tamanoBloque - 1; j > 0; j--){
          texto[i+j] = (unsigned char)texto[i+j] ^ (unsigned char)texto[i+j-1];
      }

      // XOR se revierte a si mismo directamente
      for(int j = 0; j < tamanoBloque; j++){
        texto[i+j] = (unsigned char)texto[i+j] ^ (unsigned char)clave[j];
      }
    }
  }

  // Borramos los caracteres extra que agregamos con PKCS#7
  if (texto.length() > 0) {
      int bytesExtra = (unsigned char)texto[texto.length() - 1];

      if (bytesExtra > 0 && bytesExtra <= tamanoBloque) {
          texto.erase(texto.length() - bytesExtra);
      }
  }

  return texto;
}


int main(int argc, char* argv[]) {
    string texto, clave;

    if (argc >= 3) {
        modoVisual = true;
        texto = desdeHex(argv[1]);
        clave = desdeHex(argv[2]);
    } else {
        cout << "Ingresa el texto (max 100 caracteres): ";
        getline(cin, texto);
        cout << "Ingresa la clave (max 16 caracteres): ";
        getline(cin, clave);
    }

    if (texto.length() > 100) texto = texto.substr(0, 100);
    if (clave.length() > 16) clave = clave.substr(0, 16);

    if (clave.empty()) {
        fprintf(stderr, "La clave no puede estar vacia\n");
        return 1;
    }

    if (modoVisual) {
        printf("LLAVE|%s\n", aHex(derivarLlave(clave)).c_str());
        printf("BLOQUES|%d\n", (int)(texto.length() / 16) + 1);

        string cifrado = encriptar(texto, clave);
        string descifrado = desencriptar(cifrado, clave);

        printf("CIFRADO|%s\n", aHex(cifrado).c_str());
        printf("DESCIFRADO|%s\n", aHex(descifrado).c_str());
        return 0;
    }

    string cifrado = encriptar(texto, clave);
    cout << "\n--- Resultado ---" << endl;
    cout << "Cifrado: " << cifrado << endl;

    string descifrado = desencriptar(cifrado, clave);
    cout << "Descifrado: " << descifrado << endl;

    cout << "Cifrado (Hex): " << aHex(cifrado) << endl;
    cout << "Descifrado (Hex): " << aHex(descifrado) << endl;

    return 0;
}
