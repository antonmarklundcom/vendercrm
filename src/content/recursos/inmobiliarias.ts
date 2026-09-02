import type { Article } from "./types";

// Cluster: inmobiliarias. Speed of reply and the minimum record-keeping —
// never "inmobiliaria en Asunción" or the vertical page's own terms.

export const velocidadDeRespuesta: Article = {
  slug: "velocidad-de-respuesta-inmobiliaria",
  vertical: "inmobiliarias",
  title: "La consulta por un inmueble dura horas, no días",
  metaTitle: "Velocidad de respuesta en una inmobiliaria: por qué decide la venta | clientes.com.py",
  description:
    "Por qué el primero en responder se queda con la visita, cómo medir tu tiempo real de respuesta y qué se puede automatizar sin sonar automático.",
  eyebrow: "Inmobiliarias · proceso",
  lead: "Quien pregunta por una propiedad está preguntando por cinco. No compite tu comisión: compite tu velocidad.",
  updated: "2026-09-01",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "Un interesado abre el portal, ve seis publicaciones que le sirven y escribe a las seis. No está evaluando inmobiliarias: está juntando respuestas. La primera que llega con algo concreto se lleva la conversación, y muchas veces la visita.",
    },
    { kind: "h2", text: "Medí tu tiempo real, no el que creés" },
    {
      kind: "p",
      text: "Tomá las últimas veinte consultas y anotá la hora de entrada y la hora de la primera respuesta útil. Útil significa que dice algo del inmueble o propone una visita; un \"hola, ya te paso info\" no cuenta, porque no permite avanzar.",
    },
    {
      kind: "list",
      items: [
        "Si el promedio está en minutos, el problema no es este: mirá el seguimiento posterior.",
        "Si está en horas, estás perdiendo las consultas de mayor intención — las que se mandan justo después de ver la publicación.",
        "Si está en días, no importa cuánto invertís en portales: estás pagando para que atienda el que responde primero.",
      ],
    },
    { kind: "h2", text: "Los tres momentos que se pierden" },
    {
      kind: "p",
      text: "El primero es de noche y fin de semana, que es cuando la gente mira propiedades. El segundo es la consulta que entra mientras el asesor está en una visita — la más cara de perder, porque llega de alguien activo. El tercero es la que se respondió y quedó sin próximo paso.",
    },
    {
      kind: "callout",
      text: "Una respuesta automática que reconoce el mensaje, nombra la propiedad por la que preguntaron y dice cuándo van a llamar no es fría. Fría es el silencio de doce horas.",
    },
    { kind: "h2", text: "Qué contestar en el primer mensaje" },
    {
      kind: "list",
      items: [
        "El dato que no está en la publicación: expensas, estado de ocupación, si acepta crédito, cuándo se puede visitar. Da motivo para seguir la conversación con vos.",
        "Una propuesta de visita con dos horarios concretos. Una pregunta abierta obliga al otro a organizar; dos opciones se contestan con una palabra.",
        "Una pregunta corta que califica sin interrogar: para vivir o para invertir, y para cuándo.",
      ],
    },
    { kind: "h2", text: "Después de la visita empieza el trabajo real" },
    {
      kind: "p",
      text: "En inmuebles casi nadie decide en la primera visita, y casi nadie avisa que se cayó. Un interesado que vio dos propiedades y no volvió a escribir sigue buscando; si tenés escrito qué buscaba y cuánto puede pagar, la próxima propiedad que entra en cartera tiene un destinatario con nombre. Sin eso, cada publicación nueva empieza de cero.",
    },
    {
      kind: "math",
      title: "Lo que vale una cartera anotada",
      rows: [
        { label: "Interesados atendidos en el semestre", value: "120" },
        { label: "Con requisitos escritos (zona, monto, plazo)", value: "poné el tuyo" },
        { label: "Propiedades nuevas que entran por mes", value: "poné el tuyo" },
        { label: "Avisos dirigidos que podrías mandar hoy", value: "el cruce de los dos" },
      ],
      note: "Ese cruce es la diferencia entre publicar y avisar. No requiere más inversión en portales: requiere que lo que se conversó quede escrito en algún lugar que no sea el chat.",
    },
  ],
  related: ["orden-minimo-fichas-inmobiliaria", "turnos-que-se-pierden-whatsapp"],
  waPrefill:
    "Hola, leí el artículo sobre velocidad de respuesta y quiero mejorar la de mi inmobiliaria.",
};

export const ordenMinimoFichas: Article = {
  slug: "orden-minimo-fichas-inmobiliaria",
  vertical: "inmobiliarias",
  title: "Una ficha por propiedad y una por interesado",
  metaTitle: "El orden mínimo de una inmobiliaria: fichas y seguimiento | clientes.com.py",
  description:
    "El registro mínimo que necesita una inmobiliaria para no perder interesados: qué anotar de cada propiedad, qué de cada persona y cómo cruzarlos.",
  eyebrow: "Inmobiliarias · orden",
  lead: "No hace falta un sistema grande. Hacen falta dos listas que se puedan cruzar, y la disciplina de escribir después de cada visita.",
  updated: "2026-09-01",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "La mayoría de las inmobiliarias chicas tiene la cartera de propiedades ordenada y la de interesados en la cabeza de cada asesor. Cuando el asesor se va, se va la cartera. Cuando entra una propiedad nueva, nadie sabe a quién avisarle.",
    },
    { kind: "h2", text: "Qué anotar de cada propiedad" },
    {
      kind: "list",
      items: [
        "Lo obvio: zona, tipo, superficie, precio, estado de ocupación.",
        "Lo que se pregunta siempre y nunca está escrito: expensas, si acepta crédito bancario, antigüedad, si hay deuda o algún tema de documentación.",
        "Quién es el dueño y qué acordaron: exclusividad, comisión, hasta cuándo.",
        "Las visitas hechas y qué dijo cada visitante. Es el mejor informe que le podés dar al propietario cuando hay que hablar de bajar el precio.",
      ],
    },
    { kind: "h2", text: "Qué anotar de cada interesado" },
    {
      kind: "list",
      items: [
        "Zona y tipo que busca, en sus palabras.",
        "Rango de monto y si es contado o con crédito. Cambia por completo qué se le puede ofrecer.",
        "Para cuándo. Alguien que se muda en dos meses y alguien que mira \"por si aparece algo\" no son el mismo contacto.",
        "Qué vio ya y por qué no le sirvió. Es lo que más se olvida y lo que más ahorra tiempo después.",
      ],
    },
    {
      kind: "callout",
      text: "Si esas dos listas existen y se pueden filtrar, cada propiedad nueva sale con una lista de personas a las que avisar el mismo día. Eso es todo el aparato: no hay magia debajo.",
    },
    { kind: "h2", text: "El hábito que lo sostiene" },
    {
      kind: "p",
      text: "Escribir después de la visita, no al final de la semana. Tres líneas alcanzan: qué le gustó, qué no, cuál es el próximo paso y cuándo. La regla práctica es que cualquier conversación abierta debe tener una fecha próxima escrita; si no la tiene, está muerta y conviene marcarla como tal.",
    },
    {
      kind: "p",
      text: "El costo de no hacerlo no se ve nunca, porque se paga en algo que no ocurre: la llamada que nadie hizo a la persona que sí habría comprado esa propiedad. Por eso es la parte que siempre se posterga, y por eso conviene que el sistema la pida en lugar de esperar que alguien se acuerde.",
    },
  ],
  related: ["velocidad-de-respuesta-inmobiliaria", "agenda-llena-facturacion-irregular"],
  waPrefill:
    "Hola, leí el artículo sobre fichas y seguimiento y quiero ordenar mi inmobiliaria.",
};
