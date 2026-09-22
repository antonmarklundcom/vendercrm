import type { Article } from "./types";

// Cluster: comercios y tiendas. The vertical page owns "más clientes para tu
// comercio"; these two are about what happens after someone asks, and about
// measuring a boosted post — MARKETING_SITE_PLAN.md §7.

export const consultaDePrecio: Article = {
  slug: "consulta-de-precio-whatsapp",
  vertical: "comercios",
  title: "El que pregunta el precio ya quiere comprar",
  metaTitle: "Consultas de precio por WhatsApp que no terminan en venta | clientes.com.py",
  description:
    "Por qué tantos \"¿cuánto sale?\" no vuelven a escribir, cómo medirlo en una semana y qué cambiar en la respuesta para que termine en venta.",
  eyebrow: "Comercios · WhatsApp",
  lead: "\"¿Cuánto sale?\" no es curiosidad. Es alguien con la billetera en la mano, comparando. Lo que decide la venta es lo que pasa en los minutos siguientes.",
  updated: "2026-09-22",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "Todo comercio que vende por WhatsApp conoce la escena: llega la pregunta, se contesta con el precio, y la conversación termina ahí. No hubo un no. Simplemente no hubo nada más. Y como no hubo un no, nadie lo cuenta como venta perdida.",
    },
    { kind: "h2", text: "Por qué el precio solo no vende" },
    {
      kind: "p",
      text: "Quien pregunta el precio casi nunca te pregunta solo a vos. Está mandando el mismo mensaje a dos o tres comercios. El precio le sirve para comparar, pero la compra la cierra el que le hace fácil el paso siguiente.",
    },
    {
      kind: "list",
      items: [
        "Responder tarde: si la respuesta llega cuando ya le contestó otro, el precio ya no importa.",
        "Responder solo el número: \"150.000\" contesta la pregunta y deja la conversación sin salida.",
        "No decir lo que la persona necesita para decidir: si hay stock, en qué talle o color, si hay envío y cuándo llega.",
        "No volver a escribir: el que dijo \"lo pienso\" y no recibió nada más, compró en otro lado o no compró.",
      ],
    },
    { kind: "h2", text: "Cómo medirlo en una semana" },
    {
      kind: "p",
      text: "Durante siete días marcá cada consulta de precio que entra: una etiqueta en WhatsApp Business alcanza. Al final de la semana contá cuántas terminaron en venta. No hace falta más precisión que esa para saber dónde estás.",
    },
    {
      kind: "math",
      title: "Un ejemplo para ver la forma del problema",
      rows: [
        { label: "Consultas de precio en la semana", value: "60" },
        { label: "Terminaron en venta", value: "15" },
        { label: "Ticket promedio", value: "180.000 Gs." },
        { label: "Si 5 consultas más compraran", value: "+900.000 Gs. por semana" },
      ],
      note: "Los números son un ejemplo, no un promedio del sector. Poné los tuyos: lo que importa es ver cuánto vale cada consulta que hoy se va sin respuesta completa.",
    },
    { kind: "h2", text: "La respuesta que vende" },
    {
      kind: "p",
      text: "Una buena respuesta a \"¿cuánto sale?\" tiene tres partes y entra en un mensaje:",
    },
    {
      kind: "list",
      items: [
        "El precio, claro y sin vueltas.",
        "Lo que la persona necesita para decidir: stock, variantes disponibles, envío o retiro, y en cuánto tiempo.",
        "Una pregunta que avance: \"¿Te lo separo para retirar hoy?\" o \"¿A qué barrio te lo mando?\".",
      ],
    },
    {
      kind: "callout",
      text: "Guardá esa respuesta como respuesta rápida para tus diez productos más consultados. Contestar en un minuto con toda la información vale más que cualquier descuento.",
    },
    {
      kind: "p",
      text: "Y a quien no contestó, un solo mensaje al día siguiente: \"¿Pudiste ver lo del [producto]? Me queda uno en tu talle\". Uno, no tres. Es la venta más barata que vas a hacer en la semana: esa persona ya te eligió una vez para preguntar.",
    },
  ],
  related: ["publicacion-promocionada-vendio", "velocidad-de-respuesta-inmobiliaria"],
  waPrefill:
    "Hola, leí el artículo sobre las consultas de precio por WhatsApp y quiero vender más en mi comercio.",
};

export const publicacionPromocionada: Article = {
  slug: "publicacion-promocionada-vendio",
  vertical: "comercios",
  title: "¿Vendió algo esa publicación promocionada?",
  metaTitle: "Cómo saber si una publicación promocionada vendió | clientes.com.py",
  description:
    "Una cuenta simple para saber si lo que pagaste para promocionar una publicación en Instagram o Facebook volvió en ventas, con los datos que ya tenés.",
  eyebrow: "Comercios · números",
  lead: "Los likes y el alcance te los muestra la app. Lo que no te muestra es si alguien compró. Esa cuenta la tenés que hacer vos, y es más corta de lo que parece.",
  updated: "2026-09-22",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "\"Promocionar publicación\" es el botón más fácil de apretar en Instagram. Por eso también es donde más plata se va sin que nadie sepa si volvió. La app te dice cuánta gente vio el anuncio. Nunca te dice cuánto vendiste.",
    },
    { kind: "h2", text: "Lo que necesitás anotar" },
    {
      kind: "list",
      items: [
        "Cuánto gastaste en la promoción, el número exacto que te cobraron.",
        "Cuántos mensajes llegaron por ese anuncio. Preguntá \"¿nos viste en Instagram?\" o usá un texto propio en el botón de mensaje para reconocerlos.",
        "Cuántos de esos mensajes compraron, y por cuánto.",
        "Tu margen: de cada 100.000 Gs. que vendés, cuánto te queda después de pagar la mercadería.",
      ],
    },
    {
      kind: "math",
      title: "La cuenta completa, con un ejemplo",
      rows: [
        { label: "Gasto en la promoción", value: "350.000 Gs." },
        { label: "Mensajes que llegaron por el anuncio", value: "28" },
        { label: "Compraron", value: "6" },
        { label: "Venta total", value: "1.260.000 Gs." },
        { label: "Margen bruto (40 %)", value: "504.000 Gs." },
        { label: "Resultado después del anuncio", value: "154.000 Gs." },
      ],
      note: "Ojo con comparar el gasto contra la venta: 1.260.000 contra 350.000 parece un éxito enorme, pero lo que te queda es el margen, no la venta. Con tu propio margen el resultado puede darte positivo, cero o negativo, y cada uno te dice algo distinto.",
    },
    { kind: "h2", text: "Cómo leer el resultado" },
    {
      kind: "list",
      items: [
        "Positivo: repetí la misma publicación o una parecida, con el mismo público. Subí el presupuesto de a poco, no de golpe.",
        "Cerca de cero: mirá la conversión antes que el anuncio. Si llegaron 28 mensajes y compraron 6, quizás el problema está en cómo se respondieron los otros 22.",
        "Negativo con pocos mensajes: el anuncio no le habló a la gente correcta. Cambiá el producto, la foto o la zona antes de volver a gastar.",
        "No lo podés calcular: ese es el primer arreglo. Sin saber de dónde vino cada mensaje, cualquier decisión es a ojo.",
      ],
    },
    {
      kind: "callout",
      text: "Una promoción que no vendió no es plata perdida si te dejó el dato. Lo que sí se pierde es promocionar tres veces sin anotar nada.",
    },
    {
      kind: "p",
      text: "Hacé esta cuenta con cada promoción durante un mes. Al final vas a tener una lista corta de lo que vende y lo que no, y la próxima vez el botón de promocionar deja de ser una apuesta.",
    },
  ],
  related: ["consulta-de-precio-whatsapp", "promocion-dias-flojos-restaurante"],
  waPrefill:
    "Hola, leí el artículo sobre las publicaciones promocionadas y quiero saber qué me está vendiendo.",
};
