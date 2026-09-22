import type { Article } from "./types";

// Cluster: talleres y servicios técnicos. The vertical page owns "más clientes
// para tu taller"; these two are about the enquiries lost while working and
// the customers you already have — MARKETING_SITE_PLAN.md §7.

export const consultasMientrasTrabajas: Article = {
  slug: "consultas-perdidas-mientras-trabajas",
  vertical: "talleres",
  title: "Las consultas que se pierden mientras tenés las manos ocupadas",
  metaTitle: "Consultas perdidas mientras trabajás: cuánto cuestan a un taller | clientes.com.py",
  description:
    "Cuánto le cuestan a un taller o servicio técnico las llamadas y mensajes que no se atienden a tiempo, y cómo responder sin soltar la herramienta.",
  eyebrow: "Talleres · proceso",
  lead: "El que tiene una urgencia no espera: escribe, y si nadie contesta, llama al siguiente. El problema es que cuando más te escriben es cuando más ocupado estás.",
  updated: "2026-09-22",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "Un técnico que trabaja solo o con un ayudante vive una contradicción: el trabajo que tiene hoy no le deja atender el trabajo de mañana. Mientras está debajo de un auto o arriba de una escalera, el teléfono suena y no puede contestar.",
    },
    { kind: "h2", text: "Por qué la urgencia no espera" },
    {
      kind: "p",
      text: "Quien busca un taller o un técnico casi siempre tiene algo roto: el auto que no arranca, el aire que no enfría en pleno verano, una pérdida de agua. No está comparando precios con calma. Quiere que alguien le diga \"te atiendo\" lo antes posible, y el primero que lo dice suele quedarse con el trabajo.",
    },
    { kind: "h2", text: "Cuánto cuesta, con tus números" },
    {
      kind: "p",
      text: "Durante una semana anotá cada llamada perdida y cada mensaje que contestaste más de una hora después. Después contá cuántos de esos terminaron en trabajo. Esa diferencia es la que se escapa.",
    },
    {
      kind: "math",
      title: "Un ejemplo para hacer la cuenta",
      rows: [
        { label: "Consultas no atendidas a tiempo en la semana", value: "6" },
        { label: "Cuántas cierran cuando sí respondés rápido", value: "1 de cada 2" },
        { label: "Trabajos perdidos por semana", value: "3" },
        { label: "Trabajo promedio", value: "450.000 Gs." },
        { label: "Por mes (4 semanas)", value: "5.400.000 Gs." },
      ],
      note: "Los números son un ejemplo, no un promedio del rubro. Con tu registro de una semana vas a tener los tuyos, y casi siempre alcanzan para justificar resolverlo.",
    },
    { kind: "h2", text: "Responder sin soltar la herramienta" },
    {
      kind: "list",
      items: [
        "Una respuesta automática de WhatsApp Business que diga que estás en un trabajo, en cuánto tiempo vas a contestar y qué datos te sirven: marca y modelo, qué falla, en qué barrio.",
        "Con esos datos ya escritos, cuando terminás podés responder con un presupuesto o un horario en un solo mensaje, en vez de empezar la conversación de cero.",
        "Un momento fijo para responder: al terminar cada trabajo, antes de empezar el siguiente. Cinco minutos que valen más que cualquier anuncio.",
        "Si tenés ayudante, que la tarea de contestar sea de alguien concreto, no \"del que pueda\".",
      ],
    },
    {
      kind: "callout",
      text: "La respuesta automática no cierra el trabajo, pero frena la búsqueda. Quien recibe \"te contesto en 40 minutos, contame qué le pasa\" deja de llamar a otros mientras tanto.",
    },
    {
      kind: "p",
      text: "Cuando las consultas que ya llegan dejan de perderse, recién ahí tiene sentido pagar por traer más. Antes, cada anuncio suma llamadas a un teléfono que no se puede atender.",
    },
  ],
  related: ["recordatorio-de-mantenimiento-clientes", "seguimiento-de-presupuestos-obra"],
  waPrefill:
    "Hola, leí el artículo sobre las consultas que se pierden mientras trabajo y quiero ordenar mi taller.",
};

export const recordatorioDeMantenimiento: Article = {
  slug: "recordatorio-de-mantenimiento-clientes",
  vertical: "talleres",
  title: "El cliente que ya tenés vuelve si alguien le avisa",
  metaTitle: "Recordatorios de service y mantenimiento: clientes que vuelven | clientes.com.py",
  description:
    "Cómo convertir a los clientes que ya atendiste en trabajo recurrente con un recordatorio de service o mantenimiento por WhatsApp, y cuánto puede valer.",
  eyebrow: "Talleres · clientes",
  lead: "El cambio de aceite, la limpieza del aire, la revisión anual. Son trabajos que el cliente va a hacer sí o sí. La única pregunta es si los hace con vos o con el primero que encuentra.",
  updated: "2026-09-22",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "Conseguir un cliente nuevo cuesta: anuncios, reseñas, tiempo. Un cliente que ya atendiste ya te conoce, ya confió en vos una vez y ya sabe dónde estás. Y sin embargo, cuando le toca el próximo service, muchas veces busca en Google como si nunca te hubiera conocido.",
    },
    { kind: "h2", text: "Por qué no vuelven solos" },
    {
      kind: "p",
      text: "No es que no quedaron conformes. Es que nadie se acuerda de cuándo le toca el cambio de aceite o la limpieza del aire. Cuando se acuerdan, es porque algo empezó a fallar, y en ese apuro llaman al que aparece primero.",
    },
    { kind: "h2", text: "Lo que necesitás para empezar" },
    {
      kind: "list",
      items: [
        "Una lista de los clientes que atendiste en el último año, con nombre, teléfono, qué trabajo se hizo y la fecha. Si está en un cuaderno, alcanza para empezar.",
        "Cada cuánto conviene repetir cada servicio: kilómetros o meses para el auto, una vez por temporada para el aire, lo que corresponda a tu rubro.",
        "Un mensaje corto, con el nombre de la persona y lo que le toca: \"Hola Carlos, se cumplen seis meses del service de tu aire. ¿Te agendo una limpieza antes del verano?\".",
      ],
    },
    {
      kind: "math",
      title: "Una cuenta de ejemplo",
      rows: [
        { label: "Clientes atendidos el último año", value: "200" },
        { label: "Necesitan un service periódico", value: "120" },
        { label: "Vuelven con el aviso (supuesto: 1 de cada 4)", value: "30" },
        { label: "Service promedio", value: "250.000 Gs." },
        { label: "Trabajo recuperado", value: "7.500.000 Gs." },
      ],
      note: "El \"1 de cada 4\" es un supuesto para hacer la cuenta, no una estadística. Mandá el primer grupo de avisos y medí cuántos vuelven: ese va a ser tu número real.",
    },
    { kind: "h2", text: "Que no dependa de acordarte" },
    {
      kind: "p",
      text: "La parte difícil no es mandar el mensaje: es mandarlo en el momento justo, a cada cliente, todos los meses, sin que se pase ninguno. Por eso conviene que la fecha del próximo aviso quede anotada el mismo día que terminás el trabajo, y que el recordatorio salga solo.",
    },
    {
      kind: "callout",
      text: "Un aviso bien hecho no se siente como publicidad. Se siente como un técnico que se acuerda de vos, y eso es justamente lo que hace que vuelvan.",
    },
    {
      kind: "p",
      text: "Empezá con los clientes de los últimos tres meses. Si de ese primer grupo vuelve aunque sea un par, ya tenés la prueba de que tu lista de clientes vale más que cualquier anuncio.",
    },
  ],
  related: ["consultas-perdidas-mientras-trabajas", "cuanto-deja-un-pedido-por-app"],
  waPrefill:
    "Hola, leí el artículo sobre los recordatorios de mantenimiento y quiero que mis clientes vuelvan.",
};
