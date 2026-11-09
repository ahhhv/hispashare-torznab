# hispashare-torznab

Un **stack completo** para tener series y películas de **Hispashare** de forma automática en una Orange Pi (o en cualquier máquina con Docker, arm64 o amd64). La pieza nueva es **hispashare-torznab**, un indexador Torznab que usa la **API oficial** de Hispashare.

| Servicio | Puerto | Para qué sirve |
|---|---|---|
| **Jellyfin** | 8096 | Reproducir tu biblioteca en la tele, el móvil o el navegador |
| **Sonarr** | 8989 | Seguir series: busca los capítulos, los descarga y los ordena |
| **Radarr** | 7878 | Lo mismo para películas |
| **Prowlarr** | 9696 | Gestiona los indexadores y los reparte a Sonarr y Radarr |
| **hispashare-torznab** | 9118 | Indexador Torznab que busca en la API de Hispashare |
| **aMuTorrent** | 4000 | Se hace pasar por qBittorrent ante Sonarr y Radarr y manda las descargas a aMule |
| **aMule** | 4711 | Descarga por ed2k/Kad |

```
                      ┌──────────── Prowlarr ◀──(Torznab)── hispashare-torznab ──(API)──▶ api.hispashare.org
                      ▼
Jellyfin ◀── biblioteca ◀── Sonarr / Radarr ──(«qBittorrent»: magnet ed2k)──▶ aMuTorrent ──(EC)──▶ aMule
```

- El indexador está hecho en Node.js 22 y no tiene ninguna dependencia. Su imagen (`ghcr.io/ahhhv/hispashare-torznab`) es multiarquitectura, se ejecuta con un usuario sin privilegios y trae healthcheck.
- Devuelve un resultado por archivo (cada enlace ed2k), con un título de release que Sonarr y Radarr saben interpretar y el magnet «falso» que espera aMuTorrent.
- El resto son imágenes oficiales: `ngosang/amule`, `g0t3nks/amutorrent`, y Prowlarr, Sonarr, Radarr y Jellyfin de linuxserver.io.

> **Usa la API con moderación.** Hispashare la ofrece gratis y cada token tiene un límite de peticiones por hora. El indexador guarda las respuestas en caché, deja de pedir en cuanto recibe un 429 y no pasa de unas pocas páginas por búsqueda. Aun así, lo que más consume es la búsqueda automática de Sonarr y Radarr: no programes búsquedas masivas, no bajes la caché a cero y no compartas tu token.

---

## 1. Conseguir el token de Hispashare

1. Inicia sesión en https://www.hispashare.org.
2. Abre https://www.hispashare.org/token/ y copia el token.
3. El token no cambia. Si alguna vez se filtra, genera otro en https://www.hispashare.org/token/?update=true; el anterior deja de funcionar.

El token solo se lee de la variable de entorno `HISPASHARE_TOKEN`. No se guarda en la imagen ni en ningún archivo del repo, y nunca sale en los logs.

## 2. Instalación

Necesitas Docker con el plugin compose (`docker compose version`).

```sh
git clone https://github.com/ahhhv/hispashare-torznab.git
cd hispashare-torznab

cp .env.example .env
openssl rand -hex 16     # usa el resultado como TORZNAB_APIKEY
nano .env                # rellena el token, la apikey, las contraseñas y las rutas

mkdir -p data/{amule/config,downloads/temp,downloads/sonarr,downloads/radarr,amutorrent,amutorrent-logs,prowlarr,sonarr,radarr,jellyfin}
chown -R 1000:1000 data            # el mismo PUID:PGID que pongas en .env
# y haz lo mismo con las carpetas de MEDIA_TV y MEDIA_MOVIES

docker compose up -d
docker compose ps
```

Los siete contenedores tienen que salir `Up`. En `docker compose logs hispashare-torznab` debe aparecer `/health → 200 OK`.

Valores que tienes que rellenar en `.env`:

| Variable | Qué poner |
|---|---|
| `HISPASHARE_TOKEN` | Tu token (§1) |
| `TORZNAB_APIKEY` | Una clave inventada (`openssl rand -hex 16`); la pondrás en Prowlarr |
| `AMULE_WEBUI_PWD` / `AMULE_EC_PWD` | Contraseñas de la web de aMule y de sus conexiones externas (EC) |
| `AMUTORRENT_PASSWORD` | Contraseña del usuario `admin` de aMuTorrent |
| `DOWNLOADS` | Carpeta de descargas de aMule (por defecto `./data/downloads`) |
| `MEDIA_TV` / `MEDIA_MOVIES` | Carpetas de tus bibliotecas de series y películas |
| `PUID` / `PGID` | El usuario dueño de esas carpetas (`id tu_usuario`) |

Cada variable debe aparecer **una sola vez** en `.env`. Si alguna está repetida y una de las copias va vacía, `docker compose` dirá que falta.

## 3. Puesta en marcha, paso a paso

Como todo vive en el mismo compose, los servicios se llaman entre sí **por el nombre del contenedor** (`http://sonarr:8989`, `amutorrent`…). Desde tu navegador, entra con la IP o el nombre de la máquina (por ejemplo `http://orangepi5.local:4000`).

### 3.1 aMuTorrent (`:4000`)

1. Entra con el usuario `admin` y tu `AMUTORRENT_PASSWORD`, y completa el asistente:
   - **aMule:** ya viene configurado desde el compose.
   - **BitTorrent:** deja **todo desactivado**. El «qBittorrent» que ven Sonarr y Radarr va integrado en aMuTorrent y no necesita ningún cliente BitTorrent.
   - **Directories:** deja los valores por defecto. El aviso de GeoIP se puede ignorar.
   - **Integrations:** opcional, puedes saltártelo.
2. **ED2K Servers:** si no hay servidores, carga una lista server.met (por ejemplo `http://upd.emule-security.org/server.met`) y conéctate. Abajo debe poner **ED2K: Connected**.
3. **Categories → New Category** (deja «path mapping» desactivado):

   | Title | Download Path |
   |---|---|
   | `sonarr` | `/downloads/sonarr` |
   | `radarr` | `/downloads/radarr` |

### 3.2 Sonarr (`:8989`) y Radarr (`:7878`)

En cada uno:

1. Crea el usuario la primera vez que entres.
2. **Settings → Media Management → Add Root Folder:** `/tv` en Sonarr y `/movies` en Radarr.
3. **Settings → Download Clients → + → qBittorrent:**

   | Campo | Valor |
   |---|---|
   | Host | `amutorrent` |
   | Port | `4000` |
   | Username | `admin` |
   | Password | `AMUTORRENT_PASSWORD` (o tu API key personal de aMuTorrent) |
   | Category | `sonarr` / `radarr` |

   Pulsa **Test** y guarda.
4. Copia la **API Key** de **Settings → General**; la necesitas en Prowlarr.

aMule, aMuTorrent, Sonarr y Radarr ven las descargas en la misma ruta (`/downloads`), así que no hacen falta *Remote Path Mappings*.

### 3.3 Prowlarr (`:9696`)

1. **Settings → Apps → +** y añade **Sonarr** y luego **Radarr**:

   | Campo | Sonarr | Radarr |
   |---|---|---|
   | Prowlarr Server | `http://prowlarr:9696` | `http://prowlarr:9696` |
   | Servidor | `http://sonarr:8989` | `http://radarr:7878` |
   | API Key | la de Sonarr | la de Radarr |

2. **Indexers** (el del menú principal, no el de Settings) **→ + Add Indexer → Generic Torznab**:

   | Campo | Valor |
   |---|---|
   | Name | `Hispashare` |
   | URL | `http://hispashare-torznab:9118` |
   | API Path | `/api` |
   | API Key | `TORZNAB_APIKEY` |

   Pulsa **Test** y guarda. El indexador aparecerá solo en Sonarr y Radarr (**Settings → Indexers**).

### 3.4 Jellyfin (`:8096`)

1. Crea el usuario administrador.
2. Añade dos bibliotecas: **Series** con `/data/tvshows` y **Películas** con `/data/movies`. Elige el idioma de metadatos que prefieras.
3. Opcional: para que se actualice nada más importar, en Sonarr y Radarr ve a **Settings → Connect → + → Emby / Jellyfin**, con host `jellyfin`, puerto `8096` y una API key creada en Jellyfin (**Panel → Claves de API**).
4. **Transcodificación por hardware** (RK3588 de la Orange Pi 5): si `ls /dev/dri /dev/mpp_service /dev/rga /dev/dma_heap` encuentra los cuatro dispositivos, descomenta `devices:` y `security_opt:` del servicio `jellyfin`, ejecuta `docker compose up -d jellyfin` y elige **Rockchip MPP** en **Panel → Reproducción → Transcodificación**.

### 3.5 High ID en aMule (recomendado)

Con **Low ID** o **KAD: Firewalled** se descarga igual, pero con menos fuentes. Para tener High ID, redirige en el router `4662/TCP` y `4672/UDP` a la IP de la máquina y reinicia aMule con `docker compose restart amule`.

## 4. Comprobar que todo funciona

1. **Indexador:** con títulos que existan en Hispashare (gasta unas 10 peticiones de tu cuota):
   ```sh
   source .env
   IMDB_TV=tt0000000 SEASON=1 EP=1 Q_TV=Nombre%20Serie \
   IMDB_MOVIE=tt0000000 Q_MOVIE=Nombre%20Peli \
   URL=http://localhost:9118 ./scripts/test.sh
   ```
2. **Prowlarr → Search:** busca una película; deben salir resultados `…-HispaShare`.
3. **Radarr:**
   1. Añade la película sin «Start search».
   2. Pulsa **Interactive Search** (el icono de la persona) y descarga una versión.
   3. Comprueba que aparece en **aMuTorrent → Downloads** con la categoría `radarr` y en **Radarr → Activity → Queue**.
   4. Al terminar, Radarr la mueve a `/movies` y Jellyfin la muestra.
4. Repite con un capítulo en Sonarr.

| Síntoma | Dónde mirar |
|---|---|
| Prowlarr da error al probar el indexador | La apikey; `docker compose logs hispashare-torznab` |
| La búsqueda no da resultados | El log del indexador: qué buscó y cuántos resultados encontró |
| Sonarr o Radarr rechazan la versión | El icono rojo de la búsqueda interactiva explica el motivo |
| Se queda en la cola sin descargar | La web de aMule (`:4711`): conexión al servidor o a Kad, y puertos del router |
| Termina pero no se importa | **Activity → Queue**; suele ser de permisos (`chown -R PUID:PGID` en las carpetas) |

## 5. Usar solo el indexador

Si ya tienes tu propio stack, basta con el contenedor:

```sh
docker run -d --name hispashare-torznab --restart unless-stopped -p 9118:9118 \
  -e HISPASHARE_TOKEN=... -e TORZNAB_APIKEY=... ghcr.io/ahhhv/hispashare-torznab:latest
```

Añádelo en Prowlarr como **Generic Torznab** (URL `http://IP:9118`, API Path `/api`), o directamente en Sonarr y Radarr como **Torznab (Custom)**:

| Campo | Valor |
|---|---|
| URL / API Path | `http://IP:9118` · `/api` |
| API Key | `TORZNAB_APIKEY` |
| Categories | Sonarr: `5000,5040,5045` · Radarr: `2000,2040,2045` |

Como cliente de descargas necesitarás aMuTorrent (con aMule) configurado como «qBittorrent», como en §3.2.

Para compilar la imagen tú mismo: en `docker-compose.yml` comenta `image:`, descomenta `build: .` y usa `docker compose up -d --build`.

### Variables del indexador

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `HISPASHARE_TOKEN` | *(obligatoria)* | Token personal de Hispashare |
| `TORZNAB_APIKEY` | *(obligatoria)* | Clave propia del indexador |
| `HISPASHARE_API_URL` | `https://api.hispashare.org` | Dirección base de la API |
| `PORT` | `9118` | Puerto HTTP |
| `CACHE_TTL` | `600` | Segundos que dura en caché una búsqueda |
| `RSS_CACHE_TTL` | `300` | Segundos que dura en caché el RSS |
| `MAX_PAGES` | `2` | Páginas de `/titles` como máximo por búsqueda de texto (20 títulos por página) |
| `RSS_PAGES` | `1` | Páginas que se leen para el RSS |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error` |
| `SOURCE_MAP` | `Micro4K:WEBRip,MicroHD:WEBRip` | Fuente estándar para los nombres propios de Hispashare (§7) |
| `RELEASE_GROUP` | `HispaShare` | Sufijo `-Grupo` de los títulos |
| `FAKE_SEEDERS` | `10` | Seeders y peers ficticios, para que no se descarten los resultados |

Lo que pasa en una descarga: Sonarr manda a aMuTorrent el magnet `magnet:?xt=urn:btih:<ed2k+00000000>&dn=…&xl=…`, aMuTorrent rehace el `ed2k://` y se lo pasa a aMule. El archivo se guarda con **su nombre original de Hispashare** (por ejemplo «El instituto 2x01 Ajuste de cuentas.mkv»). Sonarr y Radarr siguen la descarga por el hash y la importan sin problema.

## 6. Cómo funciona la búsqueda

- **`imdbid`** (Radarr siempre, y Sonarr si lo manda): usa `GET /titles/imdb/{id}`, que es una sola petición.
- **Texto** (`q`): usa `GET /titles?q=` con hasta `MAX_PAGES` páginas y comprueba que todas las palabras estén en `title` o en `original_title`, sin tener en cuenta acentos ni mayúsculas. En la búsqueda libre se entienden `2x01`, `S02E01`, `S02` y el año al final («Película 2025»).
- **tvsearch** con `season`/`ep`: filtra por el número sacado del nombre del archivo (`2x01`, `2x07-08`, `S02E01`, `S02E01E02`…).
- **RSS** (sin `q` ni `imdbid`): lo último de `/titles` por `updated_at`.
- **Tipo:** `series` va a TV, `movie` a Movies, `documentary` o sin tipo según tenga o no capítulos numerados, y `music` se descarta.
- **Categorías:** 2160p va a 2045/5045, 720p y 1080p a 2040/5040, y el resto solo a 2000/5000.
- Los subtítulos sueltos (`.srt`, `.ass`…) y otros archivos que no son vídeo no se devuelven.

### Archivos sin número de capítulo

| Nombre del archivo | Qué se hace |
|---|---|
| «…Temporada 2…», «T2», «S02», «Season 2» y esa temporada **no tiene** capítulos numerados | Pack de temporada: `Serie.S02…` |
| Lo mismo, pero la temporada **ya tiene** capítulos numerados (un *making of*, un especial…) | Se omite, para que Sonarr no lo confunda con la temporada completa |
| Sin temporada reconocible | `Serie.Complete…`: solo aparece en búsquedas de texto, nunca en RSS ni en búsquedas por temporada o capítulo |

### Límite de peticiones

- Caché en memoria de `CACHE_TTL` (búsquedas) y `RSS_CACHE_TTL` (RSS). Si dos peticiones iguales llegan a la vez, se hace una sola llamada.
- Cada respuesta deja en el log `RateLimit-Remaining=N/M` (como `warn` cuando queda menos del 10 %).
- Si la API responde **429**, el servicio no vuelve a llamarla hasta que pase el `Retry-After`. Mientras tanto devuelve la copia caducada de la caché si la tiene. Si no la tiene, responde **HTTP 429 con `Retry-After`**, y Prowlarr, Sonarr y Radarr esperan antes de reintentar.

## 7. Títulos de release y calidad

Ejemplos:

```
El.instituto.S02E01.1080p.WEB-DL.x264.AAC.SPANISH-HispaShare
El.instituto.S02E07E08.1080p.WEB-DL.x264.AAC.SPANISH-HispaShare
The.Last.Frontier.2025.2160p.WEBRip.Micro4K.HDR10+.DV.10bit.x265.AAC.SPANISH.ENGLISH-HispaShare
```

- **Nombre:** `original_title` (o `title` si viene vacío), sin acentos y con puntos en lugar de espacios. En las películas se añade `production_year`.
- **Resolución y fuente** salen de `release_info`. Las fuentes estándar (WEB-DL, WEBRip, BluRay, BDRip, REMUX, HDTV, DVDRip) se dejan como vienen.
- **Nombres propios de Hispashare** (`Micro4K`, `MicroHD`…): Sonarr y Radarr no los conocen, así que se añade una fuente estándar según `SOURCE_MAP` (por defecto **WEBRip**) y se conserva la etiqueta original. El indexador no puede ver tu perfil de calidad, porque son Sonarr y Radarr los que leen el título y deciden. Para darles más o menos preferencia:
  - cambia `SOURCE_MAP` (por ejemplo `Micro4K:BluRay,MicroHD:WEB-DL`), o
  - crea un **Custom Format** en Sonarr y Radarr con una condición *Release Title* `\bMicro(4K|HD)\b` y dale la puntuación que quieras en tu perfil.
- **Códecs:** H.264/AVC pasa a `x264` y H.265/HEVC a `x265`. Para el audio: AAC, AC3, DDP (E-AC3), DTS, DTS-HD.MA, TrueHD…
- **Idiomas** en mayúsculas (`SPANISH`, `ENGLISH`, `LATINO`…). Si solo hay subtítulos, se pone `SUBS`.

## 8. Limitaciones conocidas

- **Nombres en castellano.** Si buscas por texto con el título original y Hispashare solo tiene el castellano (o al revés), puede no encontrarlo. Las búsquedas por `imdbid` evitan el problema: en Radarr van siempre, y en Sonarr solo si Prowlarr o Sonarr mandan el IMDb de la serie. Sonarr reconoce la serie por el **nombre del título de release** (el original). Si una serie tiene en Sonarr otro nombre, añade un alias o usa la búsqueda interactiva.
- **Sin endpoint por capítulo ni por id de Hispashare.** Cada búsqueda baja el título entero y filtra los archivos aquí.
- **Packs de temporada.** Un pack solo existe si Hispashare tiene un archivo único para toda la temporada. Si una temporada son muchos archivos, Sonarr los descarga capítulo a capítulo.
- **Capítulos detectados por el nombre.** Si un archivo no usa `2x01` ni `S02E01`, queda como pack o «Complete» (ver tabla de §6).
- **Límite de peticiones.** Con el RSS cada 15 minutos (lo normal en Sonarr y Radarr) y la caché, el consumo es bajo. Lo que más gasta es una búsqueda automática de muchas series o películas a la vez.
- **Seeders ficticios.** ed2k no tiene seeders: el valor 10 es inventado y no dice nada sobre cuántas fuentes tiene el archivo en aMule.
- **Nombres con `%`.** aMuTorrent decodifica dos veces el `dn` del magnet. En los nombres que contienen un `%` literal, el indexador lo codifica dos veces para que el ed2k salga bien. En el resto, el magnet es exactamente el formato de aMuTorrent.

## 9. Desarrollo y pruebas (sin token real)

```sh
npm test                    # tests unitarios y de extremo a extremo contra el mock
./scripts/test.sh --mock    # arranca el mock y el indexador y lanza las pruebas con curl
npm run mock                # solo el mock de la API en :8099 (token: test-token)
```

El mock (`mock/`) sigue el OpenAPI de Hispashare. Incluye una serie con la temporada 2 completa, un multicapítulo, un *making of*, un pack de temporada 1 y un especial; una serie en emisión con un capítulo; una película con dos versiones (Micro4K 2160p y BDRip 1080p); un título de música y relleno para probar la paginación. Además simula `RateLimit-*` y el 429 (`MOCK_RATE_LIMIT`, `MOCK_RETRY_AFTER`).

```
src/
  server.js      HTTP, apikey y rutas /api y /health
  search.js      búsqueda, filtros, RSS y paginación de resultados
  hispashare.js  cliente de la API: caché, Retry-After, RateLimit y MAX_PAGES
  release.js     archivo → resultado: título de release y categorías
  parse.js       ed2k → magnet, capítulos, release_info, códecs e idiomas
  torznab.js     XML (caps, resultados y errores)
```

Licencia MIT.
