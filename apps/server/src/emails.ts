import { formatCode, type OpeningHours } from '@open-relay/contracts';

export type EmailKind = 'registered' | 'in_transit' | 'at_point' | 'reminder' | 'collected' | 'cancelled';

export interface PointInfo {
  name: string;
  street: string;
  postcode: string;
  city: string;
  openingHours: OpeningHours;
}

/** What an email about one parcel may mention. */
export interface EmailContext {
  customerName: string;
  merchant: string;
  reference: string | null;
  code: string;
  point: PointInfo;
  trackingUrl: string;
  pickupCode: string;
  holdUntil: Date | null;
}

export interface Email {
  subject: string;
  text: string;
  html: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const date = (d: Date) =>
  d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** The customer's emails, one per step: short, with what to do next and the tracking link. */
export function renderEmail(kind: EmailKind, c: EmailContext): Email {
  const order = c.reference ? `Your order ${c.reference} from ${c.merchant}` : `Your order from ${c.merchant}`;
  const where = `${c.point.name}, ${c.point.street}, ${c.point.postcode} ${c.point.city}`;
  const hours = c.point.openingHours.map((h, i) => `${DAYS[i]}: ${h}`);
  const until = c.holdUntil ? date(c.holdUntil) : '';

  const lines: Record<EmailKind, { subject: string; body: string[]; code?: boolean }> = {
    registered: {
      subject: `${order} is on its way to ${c.point.name}`,
      body: [
        `${order} will go to ${where}.`,
        'We’ll email you again when it’s there and ready to collect.',
      ],
    },
    in_transit: {
      subject: `${order} is out for delivery`,
      body: [`A courier has your parcel and is taking it to ${where}.`],
    },
    at_point: {
      subject: `${order} is ready to collect`,
      body: [
        `Collect it at ${where}, by ${until}.`,
        'Show this code at the counter:',
      ],
      code: true,
    },
    reminder: {
      subject: `Collect your parcel by ${until}`,
      body: [
        `${order} is still waiting at ${where}. Collect it by ${until}.`,
        'Show this code at the counter:',
      ],
      code: true,
    },
    collected: {
      subject: `${order} was collected`,
      body: [`It was collected at ${c.point.name}. Thanks for using a pick-up point.`],
    },
    cancelled: {
      subject: `${order} was cancelled`,
      body: [`${c.merchant} cancelled this delivery. Contact them if that’s unexpected.`],
    },
  };
  const { subject, body, code } = lines[kind];
  const showHours = kind === 'registered' || kind === 'at_point' || kind === 'reminder';

  const text = [
    `Hi ${c.customerName},`,
    '',
    ...body,
    ...(code ? ['', `    ${c.pickupCode}`, ''] : []),
    ...(showHours ? ['', `Opening hours of ${c.point.name}:`, ...hours] : []),
    '',
    `Follow your parcel: ${c.trackingUrl}`,
    `Parcel ${formatCode(c.code)}`,
  ].join('\n');

  const e = escapeHtml;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;max-width:32rem">
<p>Hi ${e(c.customerName)},</p>
${body.map((l) => `<p>${e(l)}</p>`).join('\n')}
${code ? `<p style="font-size:2rem;font-weight:700;letter-spacing:0.2em;font-variant-numeric:tabular-nums">${e(c.pickupCode)}</p>` : ''}
${showHours ? `<p><strong>Opening hours of ${e(c.point.name)}</strong><br>${hours.map(e).join('<br>')}</p>` : ''}
<p><a href="${e(c.trackingUrl)}">Follow your parcel</a></p>
<p style="color:#666;font-size:0.875rem">Parcel ${e(formatCode(c.code))}</p>
</body></html>`;

  return { subject, text, html };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
