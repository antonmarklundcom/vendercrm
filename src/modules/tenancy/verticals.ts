// Vertical presets (plan-booking.md §6.1).
//
// The load-bearing decision, restated because every future feature will be
// tempted to break it: **presets are data, not code paths**. There is no
// `if (vertical === "clinica")` anywhere in this system and there must never
// be one. A preset is a bundle of rows — booking types, resources,
// availability, add-ons, pipeline stages, tags — that an admin could have
// typed in by hand, and once applied it is indistinguishable from having
// been typed in by hand. That is what keeps one codebase serving a barbería
// and a taller mecánico without either becoming a special case.
//
// The catalogue is pure and import-free so it can be read, diffed and tested
// without a database. Applying it lives in ./verticals-apply.ts.

export type PresetService = {
  name: string;
  extraDurationMinutes: number;
  /** Whole guaraníes. Null means "ask" — a preset should not invent prices. */
  extraPrice: number | null;
};

export type PresetBookingType = {
  name: string;
  slug: string;
  description?: string;
  durationMinutes: number;
  bufferAfterMinutes?: number;
  minNoticeMinutes?: number;
  capacity?: number;
  allowMultiService?: boolean;
  locationMode?: "in_person" | "phone" | "video" | "whatsapp";
  services?: PresetService[];
};

/**
 * An automation flow a preset brings with it (plan-booking.md §6.1).
 *
 * Data, like everything else here: the preset names a trigger, a wait and
 * what to say, and `verticals-apply.ts` builds the same graph shape out of
 * whichever of these a preset happens to list. There is no per-vertical flow
 * builder and there must never be one — a rubro that wants different wording
 * changes the string below, not a code path.
 */
export type PresetFlow = {
  /**
   * Also the idempotency key: applying a preset twice must not leave a
   * tenant with two copies of the same flow, and a name is what an admin
   * sees and would rename or delete.
   */
  name: string;
  trigger: "booking_no_show" | "booking_completed";
  /**
   * Minutes between the trigger and the message. Never zero: a reactivation
   * that arrives while the customer is still stuck in traffic reads as a
   * reproach, and a review request must not beat the customer out the door.
   */
  waitMinutes: number;
  /** Free-form WhatsApp body. `{{review_link}}` is filled in for reviews. */
  text: string;
  /**
   * Slug of one of this preset's own booking types, whose next free slots are
   * offered as tappable options after the message (the `offer_slots` action
   * B3 added). Resolved to an id when the preset is applied.
   */
  offerSlotsFor?: string;
};

/**
 * The two flows §6.1 asks for, as builders rather than copies, so that what
 * differs between rubros is visibly just the words and the waiting time.
 */
const reactivateNoShow = (
  text: string,
  offerSlotsFor: string,
  waitMinutes = 120,
): PresetFlow => ({
  name: "Reactivar ausencias",
  trigger: "booking_no_show",
  waitMinutes,
  text,
  offerSlotsFor,
});

const askForReview = (text: string, waitMinutes = 180): PresetFlow => ({
  name: "Pedir reseña",
  trigger: "booking_completed",
  waitMinutes,
  text,
});

/** Local wall clock, the shape `booking_availability_rules` stores. */
export type PresetHours = { weekday: number; start: string; end: string };

export type VerticalPreset = {
  slug: string;
  /** Shown in the wizard, in the tenant's language. */
  name: string;
  description: string;
  resources: string[];
  hours: PresetHours[];
  bookingTypes: PresetBookingType[];
  pipelineStages: string[];
  tags: string[];
  flows: PresetFlow[];
};

/**
 * The siesta split, and the reason availability rules allow several rows per
 * weekday rather than one open/close pair. Most of Paraguay outside the big
 * chains shuts between noon and half past two, and a booking system that
 * offers 13:00 because it models a day as a single interval is wrong in a
 * way the owner notices on day one.
 */
const SIESTA: PresetHours[] = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, start: "08:00", end: "12:00" },
  { weekday, start: "14:30", end: "18:30" },
]);

/** Straight through, for the verticals that do not close at midday. */
const CONTINUOUS = (start: string, end: string, weekdays = [1, 2, 3, 4, 5]): PresetHours[] =>
  weekdays.map((weekday) => ({ weekday, start, end }));

const SATURDAY_MORNING: PresetHours = { weekday: 6, start: "08:00", end: "12:00" };

export const VERTICAL_PRESETS: VerticalPreset[] = [
  {
    slug: "barberia",
    name: "Barbería o salón",
    description:
      "Turnos de 30 a 45 minutos por silla, con servicios que se suman (barba, color) y sábado a la mañana.",
    resources: ["Silla 1", "Silla 2"],
    hours: [...SIESTA, SATURDAY_MORNING],
    bookingTypes: [
      {
        name: "Corte de pelo",
        slug: "corte",
        durationMinutes: 30,
        allowMultiService: true,
        services: [
          { name: "Barba", extraDurationMinutes: 15, extraPrice: null },
          { name: "Lavado", extraDurationMinutes: 10, extraPrice: null },
          { name: "Color", extraDurationMinutes: 45, extraPrice: null },
        ],
      },
      { name: "Barba", slug: "barba", durationMinutes: 20 },
    ],
    pipelineStages: ["Consulta", "Turno agendado", "Atendido"],
    tags: ["cliente frecuente", "primera vez"],
    flows: [
      reactivateNoShow(
        "Hola {{contact.name}}, te esperábamos hoy y no llegaste a venir. ¿Querés que te busquemos otro horario?",
        "corte",
      ),
      askForReview(
        "¡Gracias por pasar por la barbería, {{contact.name}}! Si te gustó cómo quedó, nos ayudaría un montón que dejes tu reseña: {{review_link}}",
      ),
    ],
  },
  {
    slug: "clinica",
    name: "Clínica o consultorio",
    description:
      "Consultas por profesional, con seña para primera vez y recordatorio el día anterior.",
    resources: ["Consultorio 1"],
    hours: SIESTA,
    bookingTypes: [
      {
        name: "Primera consulta",
        slug: "primera-consulta",
        description: "Consulta inicial. Traé estudios previos si tenés.",
        durationMinutes: 45,
        bufferAfterMinutes: 10,
        minNoticeMinutes: 240,
      },
      {
        name: "Control",
        slug: "control",
        durationMinutes: 20,
        bufferAfterMinutes: 5,
      },
    ],
    pipelineStages: ["Consulta", "Turno agendado", "Atendido", "Control pendiente"],
    tags: ["obra social", "particular"],
    flows: [
      reactivateNoShow(
        "Hola {{contact.name}}, hoy no pudimos atenderte porque no llegaste a la consulta. ¿Querés que la reprogramemos?",
        "control",
        // A missed medical appointment is reasonably reached the same day,
        // but not within the hour: the reason is often the emergency itself.
        240,
      ),
      askForReview(
        "Gracias por tu visita, {{contact.name}}. Si te sentiste bien atendido, contarlo nos ayuda mucho: {{review_link}}",
        // Long enough that the message does not arrive in the waiting room.
        24 * 60,
      ),
    ],
  },
  {
    slug: "taller",
    name: "Taller mecánico",
    description:
      "Recepción de vehículos por bahía, con diagnóstico corto y trabajos largos separados.",
    // A bay is a thing, not a person — exactly the case `booking_resources`
    // exists for, and the reason a room must not burn a plan seat.
    resources: ["Bahía 1", "Bahía 2"],
    hours: [...CONTINUOUS("07:30", "12:00"), ...CONTINUOUS("13:30", "17:30"), SATURDAY_MORNING],
    bookingTypes: [
      {
        name: "Diagnóstico",
        slug: "diagnostico",
        durationMinutes: 30,
        minNoticeMinutes: 120,
      },
      {
        name: "Service completo",
        slug: "service",
        durationMinutes: 120,
        bufferAfterMinutes: 15,
        allowMultiService: true,
        services: [
          { name: "Cambio de aceite", extraDurationMinutes: 20, extraPrice: null },
          { name: "Alineación", extraDurationMinutes: 40, extraPrice: null },
        ],
      },
    ],
    pipelineStages: ["Consulta", "Presupuesto", "En taller", "Entregado"],
    tags: ["flota", "particular"],
    flows: [
      reactivateNoShow(
        "Hola {{contact.name}}, te esperábamos con el vehículo y no llegaste. ¿Buscamos otro día?",
        "diagnostico",
      ),
      askForReview(
        "Gracias por confiarnos tu vehículo, {{contact.name}}. Si quedaste conforme, tu reseña nos ayuda a que otros nos encuentren: {{review_link}}",
        24 * 60,
      ),
    ],
  },
  {
    slug: "gimnasio",
    name: "Gimnasio o clases",
    description:
      "Clases grupales con cupo: varias personas en el mismo horario, hasta llenar la sala.",
    resources: ["Sala principal"],
    hours: [...CONTINUOUS("06:00", "10:00"), ...CONTINUOUS("17:00", "21:00")],
    bookingTypes: [
      {
        name: "Clase de spinning",
        slug: "spinning",
        durationMinutes: 60,
        // The case capacity was built for.
        capacity: 12,
      },
      {
        name: "Funcional",
        slug: "funcional",
        durationMinutes: 45,
        capacity: 15,
      },
    ],
    pipelineStages: ["Consulta", "Clase de prueba", "Socio", "Baja"],
    tags: ["mensualidad", "clase de prueba"],
    flows: [
      reactivateNoShow(
        "Hola {{contact.name}}, hoy te perdiste la clase. ¿Te anotamos en la próxima?",
        "spinning",
        // A missed class is worth answering while the day is still on.
        90,
      ),
      askForReview(
        "¡Gracias por entrenar con nosotros, {{contact.name}}! Si te gustó la clase, contalo acá: {{review_link}}",
      ),
    ],
  },
  {
    slug: "profesionales",
    name: "Profesionales (abogados, contadores)",
    description:
      "Consultas por videollamada o en oficina, con más antelación y una reunión larga aparte.",
    resources: ["Consultas"],
    hours: SIESTA,
    bookingTypes: [
      {
        name: "Consulta inicial",
        slug: "consulta",
        durationMinutes: 30,
        minNoticeMinutes: 24 * 60,
        locationMode: "video",
      },
      {
        name: "Reunión",
        slug: "reunion",
        durationMinutes: 60,
        minNoticeMinutes: 24 * 60,
      },
    ],
    pipelineStages: ["Consulta", "Propuesta enviada", "Cliente", "Cerrado"],
    tags: ["persona física", "empresa"],
    flows: [
      reactivateNoShow(
        "Hola {{contact.name}}, no pudimos tener la consulta de hoy. ¿Coordinamos otro horario?",
        "consulta",
        240,
      ),
      askForReview(
        "Gracias por tu confianza, {{contact.name}}. Si te fue útil la consulta, una reseña nos ayuda mucho: {{review_link}}",
        24 * 60,
      ),
    ],
  },
  {
    slug: "generico",
    name: "Otro rubro",
    description: "Una cita de 30 minutos y horario de oficina. El punto de partida más neutro.",
    resources: ["Agenda"],
    hours: SIESTA,
    bookingTypes: [{ name: "Cita", slug: "cita", durationMinutes: 30 }],
    pipelineStages: ["Consulta", "Agendado", "Atendido"],
    tags: [],
    flows: [
      reactivateNoShow(
        "Hola {{contact.name}}, te esperábamos hoy. ¿Querés que te agendemos de nuevo?",
        "cita",
      ),
      askForReview(
        "¡Gracias por elegirnos, {{contact.name}}! Si tenés un minuto, tu reseña nos ayuda mucho: {{review_link}}",
      ),
    ],
  },
];

export function findPreset(slug: string | null | undefined): VerticalPreset | null {
  if (!slug) return null;
  return VERTICAL_PRESETS.find((preset) => preset.slug === slug) ?? null;
}
