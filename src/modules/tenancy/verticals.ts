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
  },
];

export function findPreset(slug: string | null | undefined): VerticalPreset | null {
  if (!slug) return null;
  return VERTICAL_PRESETS.find((preset) => preset.slug === slug) ?? null;
}
