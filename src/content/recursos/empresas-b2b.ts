import type { Article } from "./types";

// Cluster: empresas B2B. Long cycles and readiness — the vertical page owns
// the commercial terms, these two own the process questions behind them.

export const cicloDeVentaLargo: Article = {
  slug: "ciclo-de-venta-largo-seguimiento",
  vertical: "empresas-b2b",
  title: "El ciclo largo se gana con memoria, no con insistencia",
  metaTitle: "Ciclo de venta largo: cómo hacer seguimiento sin insistir | clientes.com.py",
  description:
    "Cómo sostener una venta B2B que tarda meses: qué anotar, cada cuánto volver y por qué el que recuerda el detalle gana la licitación.",
  eyebrow: "Empresas B2B · seguimiento",
  lead: "Entre la primera reunión y la orden de compra pasan meses y cambian personas. Gana el proveedor que llega con el contexto intacto.",
  updated: "2026-09-01",
  readingMinutes: 6,
  body: [
    {
      kind: "p",
      text: "En una venta B2B nadie compra en la reunión. Se presenta, se pide presupuesto, se compara, se posterga por presupuesto anual, cambia el responsable de compras, vuelve seis meses después. El proveedor que sobrevive a ese recorrido no es el más insistente: es el que todavía sabe de qué se hablaba.",
    },
    { kind: "h2", text: "Lo que hay que recordar" },
    {
      kind: "list",
      items: [
        "Quién es quién: quién usa, quién decide, quién firma y quién puede vetar. Rara vez son la misma persona, y el que veta suele no estar en ninguna reunión.",
        "El problema en las palabras del cliente, no en las tuyas. Esa frase textual es la que vuelve a abrir la conversación un año después.",
        "El calendario del cliente: cuándo cierra su presupuesto, cuándo vence el contrato con el proveedor actual. Ahí están las dos únicas fechas en que la decisión es posible.",
        "Qué objetó cada uno. Una objeción sin respuesta es la razón por la que un expediente se detiene sin que nadie avise.",
      ],
    },
    {
      kind: "callout",
      text: "Si la persona con la que hablabas se va de la empresa y con eso perdés la oportunidad, lo que tenías no era una oportunidad: era una relación personal sin respaldo escrito.",
    },
    { kind: "h2", text: "Un ritmo largo" },
    {
      kind: "p",
      text: "En ciclos de meses el seguimiento útil es mensual y siempre trae algo: un caso parecido, un cambio de precio con aviso, una novedad regulatoria que los afecta. Escribir \"¿alguna novedad?\" cada dos semanas gasta la relación y no mueve nada.",
    },
    {
      kind: "math",
      title: "Por qué el olvido es caro",
      rows: [
        { label: "Oportunidades abiertas hoy", value: "poné el tuyo" },
        { label: "Con próximo paso y fecha escritos", value: "poné el tuyo" },
        { label: "Sin contacto en 60 días", value: "poné el tuyo" },
        { label: "Ticket promedio", value: "poné el tuyo" },
      ],
      note: "La tercera fila por el ticket promedio es el dinero que está apoyado en la memoria de alguien. En ciclos largos esa cifra suele ser mayor que todo lo que la empresa gasta en captación en un año.",
    },
    { kind: "h2", text: "Cerrar los que no van" },
    {
      kind: "p",
      text: "Una lista de oportunidades donde nada se pierde nunca es una lista que nadie mira. Poné una regla explícita: sin contacto ni fecha próxima en noventa días, se marca como perdida con motivo. Se puede reabrir cuando el cliente vuelve — y vuelven. Lo que no se puede es planificar sobre una lista que miente.",
    },
    {
      kind: "p",
      text: "El resultado de esto no es vender más rápido: los ciclos largos son largos. Es no perder, en el camino, las oportunidades que ya estaban ganadas por trabajo hecho hace meses.",
    },
  ],
  related: ["cuando-un-lead-b2b-esta-listo", "seguimiento-de-presupuestos-obra"],
  waPrefill:
    "Hola, leí el artículo sobre ciclos de venta largos y quiero ordenar el seguimiento de mi empresa.",
};

export const cuandoUnLeadEstaListo: Article = {
  slug: "cuando-un-lead-b2b-esta-listo",
  vertical: "empresas-b2b",
  title: "Cuándo un contacto está listo y cuándo lo estás empujando",
  metaTitle: "Cuándo un lead B2B está listo para avanzar | clientes.com.py",
  description:
    "Señales concretas de que una oportunidad B2B avanzó de verdad, y las que solo parecen avance: cómo distinguirlas antes de invertir semanas.",
  eyebrow: "Empresas B2B · calificación",
  lead: "Una reunión cordial no es avance. Estas son las señales que sí lo son, y las que confunden a todo el mundo.",
  updated: "2026-09-01",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "El error más caro en venta B2B no es perder: es dedicarle meses a algo que nunca iba a comprar, mientras otra oportunidad real se enfría sin atención.",
    },
    { kind: "h2", text: "Señales de avance real" },
    {
      kind: "list",
      items: [
        "Te presentan a alguien más de la empresa. Nadie hace perder el tiempo de un colega por cortesía.",
        "Te dan información que no es pública: volúmenes, precios que pagan hoy, el problema con el proveedor actual.",
        "Aparece una fecha propia del cliente, no tuya: un cierre de presupuesto, un vencimiento, un proyecto que arranca.",
        "Te preguntan por implementación, plazos de entrega, soporte. Son preguntas de alguien que ya se imagina trabajando con vos.",
        "Te piden ajustar la propuesta. Una objeción concreta es mejor señal que un elogio.",
      ],
    },
    { kind: "h2", text: "Señales que parecen avance y no lo son" },
    {
      kind: "list",
      items: [
        "\"Muy interesante, mandanos la presentación.\" Cuesta cero decirlo.",
        "Una reunión larga y cordial sin ningún compromiso al final.",
        "Pedir precio antes de haber hablado del problema: suele ser para completar una comparación con tres cotizaciones.",
        "\"Lo vemos el año que viene\" sin mes ni motivo. Es un no amable, y conviene tratarlo como tal.",
      ],
    },
    {
      kind: "callout",
      text: "La prueba más simple: al terminar cualquier contacto, ¿quedó un próximo paso con fecha y con alguien responsable de cada lado? Si no, no avanzó — por bien que se haya sentido la conversación.",
    },
    { kind: "h2", text: "Qué hacer con los que no están listos" },
    {
      kind: "p",
      text: "No se descartan: se estacionan con fecha. Un contacto que dijo \"ahora no\" por presupuesto vuelve a estar disponible cuando cambia el ejercicio, y eso se puede escribir hoy. Lo que no funciona es dejarlo en la lista de activos: infla el embudo, hace que las proyecciones mientan y te ocupa el tiempo que necesita el que sí está listo.",
    },
    {
      kind: "p",
      text: "Un embudo con menos oportunidades y todas con próximo paso es más grande, en la práctica, que uno lleno de expedientes dormidos. La diferencia se ve en el trimestre siguiente, cuando la proyección se parece a lo que efectivamente entra.",
    },
  ],
  related: ["ciclo-de-venta-largo-seguimiento", "calificar-consultas-en-dos-minutos"],
  waPrefill:
    "Hola, leí el artículo sobre calificación B2B y quiero revisar mi embudo.",
};
