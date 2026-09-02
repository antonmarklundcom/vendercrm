import type { Article } from "./types";

// Cluster: constructoras. Presupuestos and their follow-up — deliberately not
// "marketing para constructoras", which the vertical page owns.

export const seguimientoDePresupuestos: Article = {
  slug: "seguimiento-de-presupuestos-obra",
  vertical: "constructoras",
  title: "Presupuesto enviado, silencio",
  metaTitle: "Presupuesto enviado y sin respuesta: cómo hacer seguimiento | clientes.com.py",
  description:
    "Qué hacer con los presupuestos que quedan sin respuesta, cada cuánto insistir y cómo saber cuáles siguen vivos sin perseguir a nadie.",
  eyebrow: "Constructoras · seguimiento",
  lead: "El presupuesto salió hace tres semanas. No hubo un no. Tampoco un sí. Esa carpeta es, casi siempre, el activo peor administrado de una constructora.",
  updated: "2026-09-01",
  readingMinutes: 6,
  body: [
    {
      kind: "p",
      text: "Un presupuesto cuesta trabajo real: visita, medición, cómputo, precios que hay que pedir. Cuando se envía, ese costo ya está hundido. Lo único que queda por decidir es si se abandona en silencio o si se lo trabaja.",
    },
    { kind: "h2", text: "El silencio casi nunca significa no" },
    {
      kind: "p",
      text: "En obra, quien pide un presupuesto suele estar pidiendo tres. Después espera al segundo, junta plata, discute con la familia o el socio, se le atraviesa un viaje. El silencio es el estado normal de una decisión que todavía no se tomó, no un rechazo educado.",
    },
    {
      kind: "p",
      text: "El problema es que la constructora lo interpreta como rechazo, porque no tiene forma de distinguir entre \"se cayó\" y \"todavía no\". Y sin esa distinción, insistir se siente como molestar.",
    },
    { kind: "h2", text: "Un ritmo que no es perseguir" },
    {
      kind: "list",
      items: [
        "A las 48 horas: confirmar que llegó y que se entiende. No preguntar si lo van a aceptar — preguntar si quedó alguna partida confusa. Es una pregunta útil para los dos y abre conversación.",
        "A los diez días: un dato nuevo, no un recordatorio. Un plazo de obra que se liberó, una variante más barata, un material que va a subir. Sin dato nuevo no hay motivo para escribir.",
        "Al mes: la pregunta directa y sin rodeos. ¿Sigue en pie o lo cerramos por ahora? Da permiso a decir que no, y un no libera tiempo.",
        "A los tres meses: reactivación. Muchas obras arrancan un trimestre después de pedir el primer presupuesto.",
      ],
    },
    {
      kind: "callout",
      text: "Tres contactos con motivo a lo largo de un mes no son insistencia. Diez mensajes de \"¿alguna novedad?\" sí. La diferencia no es la cantidad: es si el que escribe trae algo.",
    },
    { kind: "h2", text: "Lo que hace falta para sostenerlo" },
    {
      kind: "p",
      text: "Nada de esto se sostiene con memoria. Hace falta una lista donde cada presupuesto tenga tres cosas: en qué estado está, cuándo fue el último contacto y cuál es el próximo paso con fecha. Si esas tres columnas existen, el seguimiento lo puede hacer cualquiera del equipo, incluso alguien que no visitó la obra.",
    },
    {
      kind: "math",
      title: "Por qué conviene aunque cierre poco",
      rows: [
        { label: "Presupuestos enviados en el trimestre", value: "30" },
        { label: "Cerrados sin seguimiento", value: "4" },
        { label: "Recuperados con seguimiento ordenado", value: "2" },
        { label: "Margen promedio por obra", value: "poné el tuyo" },
      ],
      note: "Dos obras más en un trimestre, sobre trabajo de cotización que ya estaba pagado. Si tu margen promedio por obra paga varios meses de ordenar el proceso, la cuenta está hecha: el seguimiento no compite con vender más, compite con no cobrar lo ya trabajado.",
    },
    { kind: "h2", text: "Cerrar también es un resultado" },
    {
      kind: "p",
      text: "Un presupuesto que se marca como perdido, con el motivo escrito, vale más que uno que queda flotando. El motivo repetido — precio, plazo, se fueron con el conocido de siempre — es lo que te dice qué cambiar en el próximo. La carpeta de perdidos bien anotada es el mejor informe comercial que va a tener una constructora chica.",
    },
  ],
  related: ["cuantos-presupuestos-para-cerrar-obra", "ciclo-de-venta-largo-seguimiento"],
  waPrefill:
    "Hola, leí el artículo sobre seguimiento de presupuestos y quiero ordenar el mío.",
};

export const cuantosPresupuestos: Article = {
  slug: "cuantos-presupuestos-para-cerrar-obra",
  vertical: "constructoras",
  title: "Cuántos presupuestos necesitás para cerrar una obra",
  metaTitle: "Cuántos presupuestos necesitás para cerrar una obra | clientes.com.py",
  description:
    "Cómo medir tu tasa de cierre real en obra, qué hacer con el número y por qué cambia la forma en que cotizás.",
  eyebrow: "Constructoras · números",
  lead: "Si no sabés cuántos presupuestos hacen falta para una obra, no podés saber cuántas consultas necesitás. Y sin eso, planificar el año es adivinar.",
  updated: "2026-09-01",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "Es una sola división y casi nadie la tiene hecha: obras cerradas dividido presupuestos enviados, en un período largo. Largo importa — en obra los ciclos son de meses, y un trimestre corto miente.",
    },
    { kind: "h2", text: "Tomá un año, no un mes" },
    {
      kind: "p",
      text: "Contá los presupuestos que enviaste en un año y las obras que efectivamente arrancaron de esos presupuestos. No importa si la obra arrancó al mes siguiente o al octavo: lo que se mide es el destino de lo cotizado, no la caja del mes.",
    },
    {
      kind: "math",
      title: "La cuenta hacia atrás",
      rows: [
        { label: "Presupuestos enviados en el año", value: "60" },
        { label: "Obras cerradas de esos presupuestos", value: "9" },
        { label: "Tasa de cierre", value: "15%" },
        { label: "Para cerrar 12 obras el año que viene", value: "80 presupuestos" },
      ],
      note: "Ochenta presupuestos son unas siete visitas al mes con su cómputo. Ahí la pregunta deja de ser \"cómo consigo más obra\" y pasa a ser una de dos: consigo más consultas, o subo la tasa de cierre. Son trabajos distintos y cuestan distinto.",
    },
    { kind: "h2", text: "Dos maneras de mover el número" },
    {
      kind: "list",
      items: [
        "Subir la tasa: cotizar mejor a los que ya piden. Presupuestos más claros, entrega más rápida, seguimiento que exista. No cuesta plata, cuesta proceso.",
        "Subir el volumen: más consultas entrando. Cuesta plata, y solo rinde si la tasa no es mala — si cerrás una de veinte, duplicar consultas duplica también el trabajo de cotizar al pedo.",
      ],
    },
    {
      kind: "callout",
      text: "Una tasa muy baja rara vez es un problema de precio. Suele ser que se cotiza a cualquiera que pregunta, incluido quien todavía no tiene el terreno, el permiso ni la plata.",
    },
    { kind: "h2", text: "Calificar antes de cotizar" },
    {
      kind: "p",
      text: "Tres preguntas antes de agendar la visita ordenan el embudo entero: ¿el terreno ya está?, ¿tenés un plazo en el que querés empezar?, ¿tenés un rango de inversión pensado? Quien no puede contestar ninguna de las tres no está listo para un cómputo — está juntando ideas, y eso merece otra conversación, no dos días de trabajo.",
    },
    {
      kind: "p",
      text: "Cuando dejás de cotizar a todo el mundo pasan dos cosas a la vez: la tasa de cierre sube porque cambió quién entra, y te sobra tiempo para cotizar mejor a los que sí. Es la misma división, con mejores números en los dos lados.",
    },
  ],
  related: ["seguimiento-de-presupuestos-obra", "cuando-un-lead-b2b-esta-listo"],
  waPrefill:
    "Hola, leí el artículo sobre tasa de cierre en obra y quiero medir la mía.",
};
