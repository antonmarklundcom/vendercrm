# Conectar un sitio a VenderCRM

Tres cosas por sitio. Ninguna es grande.

## 1. Enviar el lead desde el servidor del sitio

**Nunca desde el navegador.** La clave quedaría visible en el código de la
página, y el endpoint recibiría spam de bots directamente.

- Sitio en Next.js / Node → `nextjs-route.ts`
- Sitio HTML estático en Hostinger → `php-proxy.php` (Hostinger sirve PHP
  junto a los archivos estáticos, así que no hace falta backend aparte)
- Sitio sin backend de ningún tipo → usá la página alojada
  `/f/[tenantSlug]/[formSlug]` que el CRM ya publica. No necesita clave.

La clave se copia una sola vez al crear el sitio en `/sites` y se guarda en
la variable de entorno del sitio, nunca en el repositorio.

## 2. Honeypot + Turnstile

El honeypot es un campo oculto que los humanos nunca completan y los bots sí
— si viene con contenido, se descarta la petición sin llamar al CRM. Ambos
ejemplos lo incluyen. Cloudflare Turnstile (gratis) se agrega encima cuando
el spam sea real; el spam se corta en el borde, no dentro del CRM.

## 3. El snippet de atribución

```html
<script src="https://TU-CRM/vc-attribution.js" defer></script>
```

Guarda la primera campaña con la que llegó el visitante en una cookie de 90
días y no la sobrescribe. Así, alguien que llega por un anuncio hoy y
consulta la semana que viene sigue atribuido a la campaña que realmente lo
produjo. Es el único código de cliente que este proyecto envía.

## Idempotencia

`idempotency_key` es obligatorio. Mandá un id único por envío (por ejemplo
`crypto.randomUUID()`); si la petición se reintenta por un timeout de red,
el CRM devuelve el lead original en lugar de crear uno duplicado.
