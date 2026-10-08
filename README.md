# Super Johnny — Menú con pago en línea

Esta carpeta es el sitio completo: el menú (`public/index.html`), el tablero de pedidos (`public/pedidos.html`) y el pequeño servidor que cobra con Mercado Pago (`netlify/`).

## Cómo funciona

1. El cliente arma su orden, elige **Para llevar**, ve el tiempo estimado y toca **Pagar con tarjeta**.
2. El servidor recalcula el total con los precios oficiales. Lo que mande el navegador no cuenta, así que nadie puede pagar menos.
3. Mercado Pago cobra. Al aprobarse el pago, Mercado Pago avisa al servidor, y el servidor confirma el pago preguntándole directo a Mercado Pago.
4. El pedido aparece en **/pedidos** con alarma sonora, hasta que alguien toca **Aceptar**. Si configuraste Telegram, también llega un mensaje al celular.
5. El cliente ve su código (por ejemplo **K7F3**), la hora estimada y el avance: Pagado → En cocina → ¡Listo!

Si un aviso de Mercado Pago se pierde, el pedido se rescata de dos formas: cuando el cliente regresa a la página y cuando el tablero revisa los pagos recientes cada minuto.

El botón de WhatsApp sigue igual que antes.

---

## Puesta en marcha (una sola vez)

### 1. Subir el proyecto a GitHub

Arrastrar `index.html` a Netlify ya no basta, porque el servidor necesita que Netlify lo construya.

1. Crea una cuenta gratis en github.com.
2. Ve a **New repository**, ponle de nombre `super-johnny` y márcalo como **Private**.
3. En el repositorio, entra a **Add file → Upload files** y arrastra **todo el contenido** de esta carpeta, sin la carpeta misma. Después toca **Commit changes**.

### 2. Conectar Netlify con ese repositorio

- Opción A: en tu proyecto `superjohnnysb`, entra a **Project configuration → Build & deploy** y busca **Link repository**. Elige GitHub y luego `super-johnny`.
- Opción B, si no aparece esa opción:
  1. Crea un proyecto nuevo con **Add new project → Import an existing project → GitHub → super-johnny**.
  2. Al viejo cámbiale el nombre (por ejemplo `superjohnnysb-viejo`).
  3. Al nuevo ponle `superjohnnysb` en **Project configuration → General → Change project name**, para conservar la misma dirección y el mismo QR.

La configuración de construcción ya viene en `netlify.toml`, así que no hay que llenar nada.

### 3. Mercado Pago

1. Entra a mercadopago.com.mx/developers, ve a **Tus integraciones → Crear aplicación** y elige pagos en línea con **Checkout Pro**.
2. En **Credenciales de producción**, copia el **Access Token**. Empieza con `APP_USR-`.
3. Configura los avisos:
   - Ve a **Webhooks → Configurar notificaciones**.
   - En la URL pon `https://superjohnnysb.netlify.app/api/mp-webhook` y marca el evento **Pagos**. Guarda.
   - Copia la **clave secreta** que aparece.

### 4. Variables en Netlify

Agrégalas en **Project configuration → Environment variables**:

| Variable | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | El Access Token de Mercado Pago |
| `MP_WEBHOOK_SECRET` | La clave secreta del webhook |
| `BOARD_PIN` | Un PIN de 6 dígitos o más para el tablero (no uses 123456) |
| `TELEGRAM_BOT_TOKEN` | Opcional (paso 5) |
| `TELEGRAM_CHAT_ID` | Opcional (paso 5) |

Después de guardarlas, ve a **Deploys → Trigger deploy → Deploy project** para que tomen efecto.

Mientras `MP_ACCESS_TOKEN` esté vacío, la página funciona igual que hoy: sin botón de pago y con WhatsApp.

### 5. Aviso de respaldo por Telegram (opcional, recomendado)

1. En Telegram, abre **@BotFather**, escribe `/newbot` y sigue los pasos. Te dará el **token**.
2. Mándale cualquier mensaje a tu bot. También puedes crear un grupo con el personal y agregar el bot.
3. Abre `https://api.telegram.org/bot<TOKEN>/getUpdates` en el navegador. Busca `"chat":{"id":` y copia ese número, que es el **TELEGRAM_CHAT_ID**.

### 6. Tablet de cocina

1. Abre `https://superjohnnysb.netlify.app/pedidos` y escribe el PIN.
2. Toca **Probar sonido** y deja el volumen alto.
3. En Safari o Chrome usa **Agregar a pantalla de inicio**.
4. Configura la tablet para que la pantalla no se apague mientras esté cargando.

---

## Antes de abrirlo al público: prueba con dinero de mentira

1. En Mercado Pago, ve a **Tus integraciones → Cuentas de prueba** y crea un *vendedor* y un *comprador* de prueba.
2. Entra como el vendedor de prueba y copia **su** Access Token en `MP_ACCESS_TOKEN`. Vuelve a desplegar.
3. Haz un pedido desde tu celular. En Mercado Pago inicia sesión con el comprador de prueba y paga con una **tarjeta de prueba** de la documentación de Mercado Pago.
4. Revisa que todo funcione:
   - El pedido aparece en /pedidos con alarma.
   - Llega el aviso de Telegram.
   - El cliente ve "¡Pago recibido!".
5. Cuando todo funcione, cambia `MP_ACCESS_TOKEN` por el de **tu cuenta real** y vuelve a desplegar.

## Día a día

- **Pausar pedidos en línea** (cocina saturada): usa el interruptor arriba del tablero.
- **Tiempo de espera**: tócalo arriba (10, 15, 20, 30 o 45 min). Es lo que ve el cliente antes de pagar.
- **Horario**: los pagos en línea se cierran solos 15 minutos antes del cierre. Los lunes no se aceptan.
- **Cancelar un pedido pagado**: hazlo desde el tablero y luego **reembolsa desde tu panel de Mercado Pago**. El reembolso no es automático.
- **Loyverse** (por ahora): en caja, registra la venta como cobrada con un tipo de pago "Mercado Pago en línea". Así cuadra el corte. La integración automática es la fase 5.
- **Cambiar precios**: pídeselo a Claude. Los precios del menú y los del servidor salen de la misma fuente y se actualizan juntos.

## Archivos

- `public/index.html`: el menú.
- `public/pedidos.html`: el tablero (no aparece en buscadores).
- `netlify/functions/`:
  - `status`: estado y tiempo de espera.
  - `order`: crea el pedido y el cobro.
  - `order-status`: seguimiento del cliente.
  - `mp-webhook`: avisos de Mercado Pago.
  - `board`: tablero.
- `netlify/lib/catalog.mjs`: precios oficiales del servidor.
- `netlify/lib/core.mjs`: lógica de pagos, horario y almacenamiento (Netlify Blobs).
