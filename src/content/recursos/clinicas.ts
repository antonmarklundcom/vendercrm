import type { Article } from "./types";

// Cluster: clínicas. Both articles link /soluciones/clinicas and each other;
// neither targets "marketing para clínicas" or "conseguir pacientes", which
// the vertical page owns (MARKETING_SITE_PLAN.md §7).

export const costoPorPacienteNuevo: Article = {
  slug: "costo-por-paciente-nuevo",
  vertical: "clinicas",
  title: "Cuánto te cuesta cada paciente nuevo",
  metaTitle: "Cuánto te cuesta cada paciente nuevo | clientes.com.py",
  description:
    "Cómo calcular el costo de conseguir un paciente nuevo con los datos que tu clínica ya tiene, y qué hacer con el número una vez que lo tenés.",
  eyebrow: "Clínicas · números",
  lead: "No necesitás un sistema nuevo para saberlo. Necesitás tres números que ya están en tu clínica, y una división.",
  updated: "2026-09-01",
  readingMinutes: 6,
  body: [
    {
      kind: "p",
      text: "Casi todas las clínicas que conocemos saben cuánto cobran por una consulta. Muy pocas saben cuánto les cuesta que esa consulta exista. Y esa segunda cifra es la que decide si conviene invertir más en captación o si primero hay que arreglar otra cosa.",
    },
    { kind: "h2", text: "Los tres números que ya tenés" },
    {
      kind: "p",
      text: "Tomá un mes cerrado, el anterior, no el que está corriendo. Buscá: cuánto gastaste ese mes en conseguir pacientes nuevos, cuántos pacientes nuevos atendiste, y cuánto factura en promedio un paciente en su primer año con vos.",
    },
    {
      kind: "list",
      items: [
        "Gasto en captación: publicidad, la persona que responde los mensajes si esa es su tarea, el mantenimiento del sitio, cualquier acuerdo con terceros. Si alguien de tu equipo dedica media jornada a responder, esa media jornada es gasto de captación.",
        "Pacientes nuevos del mes: primera vez que pisan la clínica. No cuentan los controles ni los que vuelven.",
        "Valor del primer año: lo que deja un paciente entre la primera consulta y los doce meses siguientes. Si no lo sabés con precisión, mirá diez fichas viejas y sacá el promedio: alcanza para decidir.",
      ],
    },
    {
      kind: "math",
      title: "Un ejemplo con números redondos",
      rows: [
        { label: "Gasto en captación del mes", value: "6.000.000 Gs." },
        { label: "Pacientes nuevos atendidos", value: "20" },
        { label: "Costo por paciente nuevo", value: "300.000 Gs." },
        { label: "Valor promedio del primer año", value: "1.800.000 Gs." },
      ],
      note: "Seis veces lo que cuesta traerlo. Con esa relación, el problema de esta clínica no es el precio de la publicidad: es no estar gastando más. Poné tus propios números — la conclusión puede darte al revés, y eso también es información.",
    },
    { kind: "h2", text: "El número que casi siempre sorprende" },
    {
      kind: "p",
      text: "Hacé el mismo cálculo una segunda vez, pero dividiendo por las consultas recibidas en lugar de por los pacientes atendidos. La diferencia entre los dos resultados es lo que te cuesta la gente que escribió y nunca llegó a sentarse en la sala de espera.",
    },
    {
      kind: "p",
      text: "En la mayoría de las clínicas esa brecha es enorme, y no es un problema de captación: la consulta llegó, se pagó por ella. Se perdió después, entre el mensaje y la agenda.",
    },
    {
      kind: "callout",
      text: "Si de cada diez personas que escriben agendan cuatro, estás pagando el precio de diez para atender a cuatro. Subir esa proporción a seis no cuesta más publicidad: cuesta responder antes y no perder el hilo.",
    },
    { kind: "h2", text: "Qué hacer con el número" },
    {
      kind: "list",
      items: [
        "Si el valor del primer año es varias veces el costo de captación y tenés agenda libre, el freno es el volumen: hay que invertir más arriba.",
        "Si están cerca, no toques la publicidad todavía. Cada consulta que se pierde en el camino te está costando el precio completo.",
        "Si no podés calcularlo porque nadie anota de dónde vino cada paciente, ese es el primer trabajo, y es de una semana: una pregunta al agendar y un lugar donde quede escrita.",
      ],
    },
    {
      kind: "p",
      text: "Volvé a hacer la cuenta cada tres meses. No para vigilar el número, sino porque cuando cambia sabés qué tocaste — y esa es la diferencia entre invertir y probar suerte.",
    },
  ],
  related: ["turnos-que-se-pierden-whatsapp", "velocidad-de-respuesta-inmobiliaria"],
  waPrefill:
    "Hola, leí el artículo sobre el costo por paciente nuevo y quiero calcularlo para mi clínica.",
};

export const turnosQueSePierden: Article = {
  slug: "turnos-que-se-pierden-whatsapp",
  vertical: "clinicas",
  title: "Los turnos que se pierden entre el mensaje y la agenda",
  metaTitle: "Turnos que se pierden entre el mensaje y la agenda | clientes.com.py",
  description:
    "Dónde se cae exactamente una consulta de WhatsApp antes de convertirse en turno, y qué se puede arreglar sin contratar a nadie.",
  eyebrow: "Clínicas · proceso",
  lead: "La consulta entró. Alguien la vio. Nadie la agendó. Este es el tramo donde una clínica pierde más pacientes que en cualquier campaña.",
  updated: "2026-09-01",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "Una persona que escribe a una clínica ya decidió lo difícil: aceptó que tiene un problema y eligió a quién preguntarle. Lo que queda es logística. Y sin embargo es ahí donde se cae la mayoría.",
    },
    { kind: "h2", text: "Los cuatro lugares donde se cae" },
    {
      kind: "list",
      items: [
        "Nadie responde en el horario en que la persona escribió. Se escribe de noche, después del trabajo, o un sábado. La respuesta del lunes llega a alguien que ya llamó a otro lado.",
        "Se responde, pero se contesta la pregunta y no se propone nada. \"Sí, atendemos eso\" es una respuesta correcta que no agenda a nadie. Falta la frase siguiente: \"tengo martes 15:30 o jueves 9:00\".",
        "Se propone un horario y la persona no contesta. Ahí termina, porque nadie tiene la tarea de volver a escribir en dos días.",
        "Se agenda y no se recuerda. El turno existe en la agenda y no en la cabeza del paciente.",
      ],
    },
    {
      kind: "p",
      text: "Ninguno de los cuatro se arregla con más publicidad. Los cuatro se arreglan con la misma cosa: que cada conversación tenga un próximo paso escrito en algún lado que no sea la memoria de quien atendió.",
    },
    { kind: "h2", text: "Cómo medirlo esta semana" },
    {
      kind: "p",
      text: "Durante siete días anotá, para cada consulta que entra: a qué hora llegó, a qué hora se respondió, y si terminó en turno. Nada más. Con eso vas a ver dos cosas.",
    },
    {
      kind: "math",
      title: "Lo que suele mostrar una semana de registro",
      rows: [
        { label: "Consultas recibidas", value: "40" },
        { label: "Respondidas dentro de la hora", value: "22" },
        { label: "Terminaron en turno", value: "16" },
        { label: "De las respondidas al día siguiente", value: "2 de 18" },
      ],
      note: "Los números son un ejemplo para mostrar la forma del problema, no un promedio del sector: hacé el registro y vas a tener los tuyos. Lo que casi siempre se repite es la forma — responder rápido no mejora un poco la conversión, la cambia de categoría.",
    },
    { kind: "h2", text: "Qué se arregla sin contratar a nadie" },
    {
      kind: "list",
      items: [
        "Una respuesta automática fuera de horario que diga cuándo van a contestar y ofrezca dejar el motivo de consulta. No cierra el turno, pero evita que la persona siga buscando.",
        "Una respuesta guardada con los dos horarios más próximos, para no redactarla cada vez.",
        "Un recordatorio a los dos días para las conversaciones que quedaron sin contestar. Una sola vez, no tres.",
        "Un recordatorio del turno el día anterior, que es lo más barato que existe contra el ausentismo.",
      ],
    },
    {
      kind: "callout",
      text: "Ninguna de estas cuatro cosas es una decisión estratégica. Son tareas que alguien tiene que hacer siempre, y que por eso conviene que no dependan de que alguien se acuerde.",
    },
    {
      kind: "p",
      text: "Cuando el tramo entre el mensaje y la agenda está resuelto, recién ahí tiene sentido preguntarse cuánto cuesta traer más consultas. Antes, invertir en captación es llenar un balde que pierde.",
    },
  ],
  related: ["costo-por-paciente-nuevo", "calificar-consultas-en-dos-minutos"],
  waPrefill:
    "Hola, leí el artículo sobre los turnos que se pierden y quiero ordenar el seguimiento de mi clínica.",
};
