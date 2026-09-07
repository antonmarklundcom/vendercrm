// Three vertical presets seeded on first visit to /contracts (§17.3 P13) —
// Spanish, generic, no legal claims beyond the firma-electrónica-simple line
// the public page itself already carries. Kept short: a tenant is expected
// to edit these into their own wording, not ship them verbatim.

export type ContractTemplatePreset = { name: string; body: string };

export const DEFAULT_CONTRACT_TEMPLATES: ContractTemplatePreset[] = [
  {
    name: "Contrato de servicio",
    body: `# Contrato de servicio

Entre {{contacto.nombre}}, en adelante "el cliente", y la empresa, se acuerda la prestación del servicio detallado a continuación.

# Alcance

Describí acá el servicio que se va a prestar, plazos y condiciones de pago.

# Datos de contacto

Teléfono: {{contacto.telefono}}
Email: {{contacto.email}}`,
  },
  {
    name: "Reserva de inmueble",
    body: `# Reserva de inmueble

Entre {{contacto.nombre}} y la empresa se acuerda la reserva del inmueble descripto a continuación, sujeta a las condiciones detalladas más abajo.

# Condiciones

Describí acá el inmueble, el monto de la reserva y el plazo para la firma del contrato definitivo.

# Datos de contacto

Teléfono: {{contacto.telefono}}
Email: {{contacto.email}}`,
  },
  {
    name: "Orden de trabajo",
    body: `# Orden de trabajo

Se deja constancia de que {{contacto.nombre}} encarga a la empresa la realización del trabajo detallado a continuación.

# Detalle del trabajo

Describí acá el trabajo a realizar, materiales incluidos y plazo estimado.

# Datos de contacto

Teléfono: {{contacto.telefono}}
Email: {{contacto.email}}`,
  },
];
