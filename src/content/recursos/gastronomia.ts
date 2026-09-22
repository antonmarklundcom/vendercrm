import type { Article } from "./types";

// Cluster: gastronomía. The vertical page owns "más clientes y pedidos para tu
// restaurante"; these two are the arithmetic behind delivery-app orders and
// slow-day promotions — MARKETING_SITE_PLAN.md §7.

export const pedidoPorApp: Article = {
  slug: "cuanto-deja-un-pedido-por-app",
  vertical: "gastronomia",
  title: "Lo que te queda de un pedido por app",
  metaTitle: "Cuánto te deja un pedido por app de delivery vs. un pedido directo | clientes.com.py",
  description:
    "La cuenta de lo que realmente te queda de un pedido que entra por una app de delivery, comparado con el mismo pedido por tu propio WhatsApp.",
  eyebrow: "Gastronomía · números",
  lead: "Las apps de delivery traen pedidos, y eso vale. Pero cada pedido que llega por ahí te deja menos que el mismo pedido directo, y conviene saber exactamente cuánto menos.",
  updated: "2026-09-22",
  readingMinutes: 5,
  body: [
    {
      kind: "p",
      text: "No hay nada de malo en vender por apps. Te ponen delante de gente que no te conocía y resuelven el reparto. El problema aparece cuando la app deja de ser una vía para conocerte y pasa a ser la única forma en que tus clientes de siempre te piden.",
    },
    { kind: "h2", text: "La cuenta de un solo pedido" },
    {
      kind: "p",
      text: "Buscá en tu contrato el porcentaje de comisión que te cobra cada app, y calculá tu costo de comida: cuánto te cuesta la materia prima de un plato promedio. Con esos dos números alcanza.",
    },
    {
      kind: "math",
      title: "Un pedido de ejemplo",
      rows: [
        { label: "Ticket del pedido", value: "100.000 Gs." },
        { label: "Comisión de la app (ejemplo: 25 %)", value: "25.000 Gs." },
        { label: "Costo de comida (35 %)", value: "35.000 Gs." },
        { label: "Te queda por app", value: "40.000 Gs." },
        { label: "Te queda si el pedido es directo", value: "65.000 Gs." },
      ],
      note: "El 25 % es un ejemplo: usá el porcentaje de tu contrato, que cambia según la app y el acuerdo. Si el pedido directo lo repartís vos, restá también lo que le pagás al repartidor. Aun así, la diferencia suele alcanzar para cubrirlo.",
    },
    { kind: "h2", text: "El costo que no aparece en la cuenta" },
    {
      kind: "p",
      text: "Hay una diferencia que no está en el ticket: el cliente que pide por la app es de la app. No tenés su número, no le podés avisar de un plato nuevo, no le podés mandar la promo del martes. Cada vez que quiera volver a comer lo tuyo, la app decide si te muestra a vos o al de al lado.",
    },
    { kind: "h2", text: "Pasar clientes de la app a tu WhatsApp" },
    {
      kind: "list",
      items: [
        "Una tarjeta en cada pedido de app con tu WhatsApp y un motivo concreto para escribir directo: un postre de regalo en el primer pedido directo, por ejemplo.",
        "Tu ficha de Google Maps con el botón de WhatsApp y el menú actualizado, para que quien te busca por nombre llegue a vos y no a la app.",
        "Respuesta inmediata cuando escriben, con el menú y cómo pedir. Si pedir directo es más lento que pedir por la app, vuelven a la app.",
        "Una lista de clientes que ya pidieron directo, para avisarles de novedades sin depender de nadie.",
      ],
    },
    {
      kind: "callout",
      text: "La meta no es dejar las apps. Es que la app te traiga clientes nuevos y que los que ya te conocen te pidan a vos.",
    },
    {
      kind: "p",
      text: "Hacé la cuenta con tus números de un mes: cuántos pedidos entraron por app y cuántos directos. Si la mitad de los de app son clientes que ya te pidieron antes, ahí está la plata que más fácil se recupera.",
    },
  ],
  related: ["promocion-dias-flojos-restaurante", "consulta-de-precio-whatsapp"],
  waPrefill:
    "Hola, leí el artículo sobre los pedidos por app y quiero que más clientes me pidan directo.",
};

export const promocionDiasFlojos: Article = {
  slug: "promocion-dias-flojos-restaurante",
  vertical: "gastronomia",
  title: "Antes de lanzar la promo del martes, hacé esta cuenta",
  metaTitle: "Promociones para días flojos: cuántos clientes necesitás para ganar | clientes.com.py",
  description:
    "Cuántos clientes de más necesita una promoción de día flojo solo para quedar igual, y cómo diseñarla para que deje ganancia y no solo movimiento.",
  eyebrow: "Gastronomía · números",
  lead: "Un 20 % de descuento el martes suena a poco. Pero para quedar igual que un martes normal, puede necesitar la mitad más de gente. Conviene saberlo antes de imprimir el cartel.",
  updated: "2026-09-22",
  readingMinutes: 6,
  body: [
    {
      kind: "p",
      text: "Llenar los días flojos es una preocupación de casi cualquier restaurante. Y la primera idea siempre es una promoción. A veces funciona. Otras veces el salón se llena, la cocina trabaja el doble y a fin de mes la cuenta da igual o peor.",
    },
    { kind: "h2", text: "La cuenta del descuento" },
    {
      kind: "p",
      text: "El descuento sale del precio, pero el costo de la comida queda igual. Por eso un 20 % menos en el ticket es mucho más que un 20 % menos en lo que te queda.",
    },
    {
      kind: "math",
      title: "Un martes de ejemplo",
      rows: [
        { label: "Cubiertos de un martes normal", value: "30" },
        { label: "Te queda por cubierto sin promo (80.000 − 32.000 de comida)", value: "48.000 Gs." },
        { label: "Te queda por cubierto con 20 % de descuento (64.000 − 32.000)", value: "32.000 Gs." },
        { label: "Cubiertos necesarios para quedar igual", value: "45" },
      ],
      note: "Quince personas más solo para no perder. Hacé la cuenta con tu ticket y tu costo de comida: el número de equilibrio es la vara con la que medir la promo, no si el salón se ve lleno.",
    },
    { kind: "h2", text: "Promociones que suelen dejar más" },
    {
      kind: "list",
      items: [
        "Sumar en vez de descontar: postre o bebida incluida en lugar de un porcentaje. Lo que regalás te cuesta tu costo, no tu precio de venta.",
        "Un combo pensado para el día flojo, con platos de buen margen y preparación rápida.",
        "Una promo para grupos: la mesa de cuatro que viene por la promo del martes pide más que una persona sola.",
        "Una promo solo para clientes que ya te conocen, avisada por WhatsApp, en lugar de un descuento para cualquiera.",
      ],
    },
    { kind: "h2", text: "Lo que vale más que el martes" },
    {
      kind: "p",
      text: "Una promoción de día flojo también es una forma de que alguien pruebe tu cocina por primera vez. Si esa persona vuelve un viernes a precio completo, la cuenta cambia. Pero solo lo vas a saber si le pedís el contacto, por ejemplo con la reserva por WhatsApp, y le avisás la próxima vez.",
    },
    {
      kind: "callout",
      text: "Antes de lanzar cualquier promo, escribí dos números: cuántos cubiertos necesita para quedar igual y cuántos esperás. Si el segundo no supera cómodo al primero, cambiá la promo, no el cartel.",
    },
    {
      kind: "p",
      text: "Después de cuatro martes con la promo, mirá los números reales contra esos dos. Esa es la diferencia entre llenar el salón y ganar plata llenándolo.",
    },
  ],
  related: ["cuanto-deja-un-pedido-por-app", "publicacion-promocionada-vendio"],
  waPrefill:
    "Hola, leí el artículo sobre las promociones de días flojos y quiero llenar mi restaurante toda la semana.",
};
