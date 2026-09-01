import type { Article } from "./types";

// Cluster: servicios profesionales (estudios contables, jurídicos, consultoras,
// arquitectura). The vertical page owns the commercial terms; these two are
// about the shape of the practice.

export const agendaLlenaFacturacionIrregular: Article = {
  slug: "agenda-llena-facturacion-irregular",
  vertical: "servicios-profesionales",
  title: "Agenda llena, facturación irregular",
  metaTitle: "Agenda llena y facturación irregular: por qué pasa | clientes.com.py",
  description:
    "Por qué un estudio con trabajo de sobra factura distinto cada mes, y qué se puede ordenar sin trabajar más horas.",
  eyebrow: "Servicios profesionales · práctica",
  lead: "Trabajás todos los días y aun así hay meses flojos. El problema rara vez es la demanda: es que la captación se apaga justo cuando estás ocupado.",
  updated: "2026-09-01",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "En un estudio chico, la misma persona vende y ejecuta. Cuando entra trabajo, se deja de vender; cuando el trabajo termina, se vuelve a vender y hay que esperar el ciclo entero. La facturación replica ese vaivén con dos o tres meses de retraso.",
    },
    { kind: "h2", text: "El ciclo se ve en el calendario" },
    {
      kind: "p",
      text: "Mirá los últimos doce meses de facturación y marcá los picos y los pozos. Después mirá qué estabas haciendo tres meses antes de cada pozo. Casi siempre vas a encontrar el mes más ocupado del año.",
    },
    {
      kind: "callout",
      text: "El mes en que estás desbordado es el mes que decide tu peor mes del trimestre siguiente. Por eso la captación no puede depender de que quede tiempo.",
    },
    { kind: "h2", text: "Lo que se puede sostener aunque estés lleno" },
    {
      kind: "list",
      items: [
        "Responder consultas nuevas dentro del día, aunque sea para agendar la conversación en dos semanas. Una consulta contestada tarde no se recupera.",
        "Un contacto trimestral con la cartera existente. En servicios profesionales la mayor parte del trabajo nuevo viene de clientes que ya te conocen, y desaparecen sin avisar cuando nadie los llama.",
        "Pedir la recomendación al cerrar un trabajo bien terminado, no seis meses después. Es el único momento en que el cliente está entusiasmado y disponible.",
        "Anotar toda consulta que no se convirtió, con el motivo. Muchas son \"ahora no\", y \"ahora no\" tiene fecha de vencimiento.",
      ],
    },
    {
      kind: "math",
      title: "El valor de la cartera dormida",
      rows: [
        { label: "Clientes atendidos en los últimos tres años", value: "poné el tuyo" },
        { label: "Con los que hablaste este trimestre", value: "poné el tuyo" },
        { label: "Diferencia", value: "tu lista de llamados" },
        { label: "Honorario promedio de un trabajo", value: "poné el tuyo" },
      ],
      note: "La diferencia entre esas dos filas es, casi siempre, el activo comercial más grande del estudio — y no cuesta publicidad. Cuesta una hora por semana y una lista que exista.",
    },
    { kind: "h2", text: "Cobrar el diagnóstico" },
    {
      kind: "p",
      text: "Muchos estudios regalan la primera reunión y después descubren que la mitad del trabajo estaba ahí. Cobrar una primera consulta acotada, con un entregable escrito, hace tres cosas a la vez: filtra a quien solo compara precios, deja algo tangible en manos del cliente, y convierte esa reunión en el primer paso de una propuesta más grande en vez de un costo hundido.",
    },
    {
      kind: "p",
      text: "Si te incomoda cobrarla, poné un precio bajo y un entregable claro. El punto no es el monto: es que la conversación tenga un producto.",
    },
  ],
  related: ["calificar-consultas-en-dos-minutos", "costo-por-paciente-nuevo"],
  waPrefill:
    "Hola, leí el artículo sobre agenda llena y facturación irregular y quiero ordenar la captación de mi estudio.",
};

export const calificarEnDosMinutos: Article = {
  slug: "calificar-consultas-en-dos-minutos",
  vertical: "servicios-profesionales",
  title: "Qué preguntar en los primeros dos minutos",
  metaTitle: "Cómo calificar una consulta en dos minutos | clientes.com.py",
  description:
    "Cuatro preguntas que separan una consulta real de una que te va a consumir la tarde, sin que el otro sienta un interrogatorio.",
  eyebrow: "Servicios profesionales · proceso",
  lead: "No todas las consultas merecen una reunión. Distinguirlas temprano es lo que te devuelve las horas que hoy regalás.",
  updated: "2026-09-01",
  readingMinutes: 4,
  body: [
    {
      kind: "p",
      text: "Calificar tiene mala fama porque suena a filtrar gente. Es lo contrario: es no hacerle perder una hora a alguien que necesita otra cosa, y no perderla vos.",
    },
    { kind: "h2", text: "Las cuatro preguntas" },
    {
      kind: "list",
      items: [
        "¿Qué pasó para que estés buscando esto ahora? Distingue un problema con fecha de una curiosidad. La palabra clave es \"ahora\".",
        "¿Ya trabajaste con alguien en esto? Te dice si vas a competir con una relación existente y por qué se rompió.",
        "¿Quién más participa de la decisión? En una empresa familiar la respuesta suele ser un hermano o un contador que no está en la reunión. Mejor saberlo antes de la propuesta.",
        "¿Tenés un presupuesto pensado o querés que te dé un orden de magnitud? Da la opción de no contestar y aun así ordena la expectativa.",
      ],
    },
    {
      kind: "callout",
      text: "Ninguna de las cuatro pregunta si va a contratar. Preguntan por el contexto — y el contexto es lo que decide, no la intención declarada.",
    },
    { kind: "h2", text: "Qué hacer con cada respuesta" },
    {
      kind: "p",
      text: "Si hay un problema con fecha, alguien que decide y un orden de magnitud aceptado, agendá la reunión y preparate. Si falta la fecha, quedó en \"ahora no\": anotalo con un recordatorio a los sesenta o noventa días, que es información valiosa, no un descarte. Si falta el presupuesto, ofrecé algo más chico antes que descontar el trabajo grande. Si falta quien decide, pedí que esté en la próxima.",
    },
    { kind: "h2", text: "Escribirlo o perderlo" },
    {
      kind: "p",
      text: "Las cuatro respuestas valen si quedan escritas donde las vas a volver a leer. Dos meses después, lo que te permite escribir un mensaje que no parece plantilla es acordarte de que la consulta venía de una fiscalización, o de que el socio que decide es el hermano. Eso no se recuerda: se anota.",
    },
    {
      kind: "p",
      text: "El efecto agregado es medible en horas. Un estudio que califica antes de reunirse hace menos reuniones, cierra una proporción mayor de las que hace, y deja de escribir propuestas largas para gente que solo quería un número por teléfono.",
    },
  ],
  related: ["agenda-llena-facturacion-irregular", "cuando-un-lead-b2b-esta-listo"],
  waPrefill:
    "Hola, leí el artículo sobre calificar consultas y quiero aplicarlo en mi estudio.",
};
