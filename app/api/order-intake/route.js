import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { sendOrderConfirmationMessages, notifyUsersServer, getOrderNotifyRecipients, getAutoConfirmSettings } from '../../../lib/serverNotify';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Public endpoint — authenticated by api_key (per landing page), not a user session.
// Called by Zapier/Make/Pabbly/WP Webhooks whenever a WordPress form is submitted.

// Resolves a dot-path like "names.first_name" against a nested object.
function getPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

// Expands "a[b][c]=x" (PHP/x-www-form-urlencoded bracket notation, which is
// what several WP Webhooks configurations send instead of JSON) into the same
// nested-object shape a JSON body would have: { a: { b: { c: 'x' } } }.
function expandBracketKey(target, rawKey, value) {
  const keys = rawKey.replace(/\]/g, '').split('[');
  let node = target;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      node[key] = value;
    } else {
      if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
      node = node[key];
    }
  });
}

function parseUrlEncoded(text) {
  const result = {};
  for (const [rawKey, value] of new URLSearchParams(text).entries()) {
    expandBracketKey(result, rawKey, value);
  }
  return result;
}

// Reads the raw request body once and tries to make sense of it regardless of
// what Content-Type header the caller actually sent. Some webhook tools
// (older/free plugin builds especially) mislabel the header, or send
// x-www-form-urlencoded even when JSON was configured — so we don't trust the
// header, we try JSON first and fall back to form-encoded parsing.
async function parseBody(request) {
  const contentType = request.headers.get('content-type') || '';
  let rawText = '';
  try {
    rawText = await request.text();
  } catch (e) {
    return { parsed: {}, rawText: '', contentType, parseMethod: 'unreadable', parseError: e.message };
  }

  if (!rawText || !rawText.trim()) {
    return { parsed: {}, rawText, contentType, parseMethod: 'empty', parseError: null };
  }

  try {
    return { parsed: JSON.parse(rawText), rawText, contentType, parseMethod: 'json', parseError: null };
  } catch (jsonErr) {
    if (rawText.includes('=')) {
      try {
        return { parsed: parseUrlEncoded(rawText), rawText, contentType, parseMethod: 'urlencoded', parseError: null };
      } catch (formErr) {
        return { parsed: {}, rawText, contentType, parseMethod: 'unparseable', parseError: formErr.message };
      }
    }
    return { parsed: {}, rawText, contentType, parseMethod: 'unparseable', parseError: jsonErr.message };
  }
}

// Best-effort diagnostic log: writes to webhook_intake_logs (see
// supabase/migration_v43.sql) AND to console so it shows up in Vercel's
// runtime logs even if the DB write itself fails. Never throws — logging
// must never be the reason an intake request fails.
async function logIntake(entry) {
  const line = `[order-intake] ${entry.success ? 'OK' : 'REJECTED'} status=${entry.status_code} reason=${entry.error_reason || 'n/a'} parse=${entry.parse_method || 'n/a'} content-type="${entry.content_type || ''}"`;
  if (entry.success) {
    console.log(line);
  } else {
    console.error(line, { raw_body: entry.raw_body, parsed_body: entry.parsed_body, resolved_fields: entry.resolved_fields });
  }

  try {
    await supabaseAdmin.from('webhook_intake_logs').insert({
      source_id: entry.source_id || null,
      api_key_used: entry.api_key_used || null,
      success: entry.success,
      status_code: entry.status_code,
      error_reason: entry.error_reason || null,
      content_type: entry.content_type || null,
      parse_method: entry.parse_method || null,
      raw_body: entry.raw_body ? entry.raw_body.slice(0, 8000) : null,
      parsed_body: entry.parsed_body ?? null,
      resolved_fields: entry.resolved_fields ?? null,
      order_id: entry.order_id || null,
    });
  } catch (e) {
    console.error('[order-intake] failed to write webhook_intake_logs row:', e.message);
  }
}

export async function POST(request) {
  const { parsed: body, rawText, contentType, parseMethod, parseError } = await parseBody(request);

  const url = new URL(request.url);
  const api_key = (body && body.api_key) || url.searchParams.get('api_key');

  if (!api_key) {
    await logIntake({
      success: false, status_code: 401, error_reason: 'Missing api_key.',
      content_type: contentType, parse_method: parseMethod, raw_body: rawText, parsed_body: body,
    });
    return NextResponse.json({ success: false, error: 'Missing api_key.' }, { status: 401 });
  }

  let source;
  try {
    const { data, error: sourceError } = await supabaseAdmin
      .from('landing_page_sources')
      .select('*')
      .eq('api_key', api_key)
      .eq('active', true)
      .maybeSingle();
    if (sourceError || !data) {
      await logIntake({
        success: false, status_code: 401, error_reason: 'Invalid or inactive api_key.',
        api_key_used: api_key, content_type: contentType, parse_method: parseMethod, raw_body: rawText, parsed_body: body,
      });
      return NextResponse.json({ success: false, error: 'Invalid or inactive api_key.' }, { status: 401 });
    }
    source = data;
  } catch (e) {
    console.error('[order-intake] unexpected error looking up source:', e);
    await logIntake({
      success: false, status_code: 500, error_reason: `Unexpected error looking up source: ${e.message}`,
      api_key_used: api_key, content_type: contentType, parse_method: parseMethod, raw_body: rawText, parsed_body: body,
    });
    return NextResponse.json({ success: false, error: 'Unable to process request right now.' }, { status: 500 });
  }

  try {
    const fieldMapping = source.field_mapping || {};
    const hasMapping = Object.keys(fieldMapping).length > 0;

    // If this source has a configured raw-field mapping, resolve every value
    // through it. Otherwise, assume the caller already sent clean field names
    // (customer, phone, etc.) at the top level — e.g. a hand-built Zapier/Make step.
    const customer = hasMapping ? getPath(body, fieldMapping.customer) : body.customer;
    const phone = hasMapping ? getPath(body, fieldMapping.phone) : body.phone;
    const phone2 = hasMapping ? getPath(body, fieldMapping.phone2) : body.phone2;
    const address = hasMapping ? getPath(body, fieldMapping.address) : body.address;
    const state = hasMapping ? getPath(body, fieldMapping.state) : body.state;
    const selected_option = hasMapping ? getPath(body, fieldMapping.selected_option) : body.selected_option;
    const quantity = hasMapping ? getPath(body, fieldMapping.quantity) : body.quantity;
    const notes = hasMapping ? getPath(body, fieldMapping.notes) : body.notes;

    const resolvedFields = { customer, phone, phone2, address, state, selected_option, quantity, notes };

    if (!customer || !phone) {
      await logIntake({
        success: false, status_code: 400, error_reason: 'customer and phone are required (resolved as empty).',
        source_id: source.id, api_key_used: api_key, content_type: contentType, parse_method: parseMethod,
        raw_body: rawText, parsed_body: body, resolved_fields: resolvedFields,
      });
      return NextResponse.json({ success: false, error: 'customer and phone are required.', received: body }, { status: 400 });
    }

    // Resolve which package/set this order is for, based on the submitted option label.
    const mapping = source.option_mapping || {};
    let resolvedPackageId = null;
    let resolvedSetId = null;

    if (selected_option && mapping[selected_option]) {
      resolvedPackageId = mapping[selected_option].package_id || null;
      resolvedSetId = mapping[selected_option].set_id || null;
    } else {
      // Single-option landing page, or no match — fall back to the one mapping entry if there's exactly one.
      const entries = Object.values(mapping);
      if (entries.length === 1) {
        resolvedPackageId = entries[0].package_id || null;
        resolvedSetId = entries[0].set_id || null;
      }
    }

    // Work out the price from whatever it resolved to — never trust a price from outside the CRM.
    let unitPrice = 0;
    let quantityToUse = parseInt(quantity, 10) || 1;
    let itemLabel = null; // human-readable product/package/set name, for confirmation messages

    if (resolvedSetId) {
      const { data: set } = await supabaseAdmin.from('product_sets').select('*').eq('id', resolvedSetId).maybeSingle();
      if (set) {
        itemLabel = set.name || null;
        if (set.price_mode === 'flat' && set.flat_price != null) {
          unitPrice = Number(set.flat_price);
        } else {
          const { data: items } = await supabaseAdmin.from('product_set_items').select('*').eq('set_id', resolvedSetId);
          const productIds = (items || []).map(i => i.product_id);
          const { data: comps } = await supabaseAdmin.from('products').select('*').in('id', productIds);
          unitPrice = (items || []).reduce((sum, i) => {
            const p = (comps || []).find(c => c.id === i.product_id);
            return sum + (p && p.default_price ? Number(p.default_price) * i.quantity_per_set : 0);
          }, 0);
        }
      }
    } else if (resolvedPackageId) {
      const { data: pkg } = await supabaseAdmin.from('product_packages').select('*').eq('id', resolvedPackageId).maybeSingle();
      if (pkg) {
        itemLabel = pkg.name || null;
        if (pkg.price != null) unitPrice = Number(pkg.price);
      }
    } else if (source.product_id) {
      const { data: product } = await supabaseAdmin.from('products').select('*').eq('id', source.product_id).maybeSingle();
      if (product) {
        itemLabel = product.name || null;
        if (product.default_price != null) unitPrice = Number(product.default_price);
      }
    }

    function normalizeState(raw) {
      if (!raw) return null;
      const s = String(raw).trim();
      const lower = s.toLowerCase();
      if (lower === 'abuja' || lower === 'fct' || lower.includes('federal capital')) return 'FCT (Abuja)';
      // Otherwise trust it if it already matches a known state name exactly (case-insensitive),
      // normalizing back to the CRM's exact casing/spelling.
      const known = [
        'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
        'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa',
        'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger',
        'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe',
        'Zamfara', 'FCT (Abuja)',
      ];
      const match = known.find(k => k.toLowerCase() === lower);
      return match || s; // fall back to whatever was sent, rather than silently dropping it
    }

    const orderPayload = {
      customer: String(customer).trim(),
      phone: String(phone).trim(),
      phone2: phone2 ? String(phone2).trim() : null,
      address: address ? String(address).trim() : '',
      state: normalizeState(state) || source.default_state || null,
      quantity: quantityToUse,
      unit_price: unitPrice,
      notes: notes ? String(notes).trim() : null,
      status: 'New',
      payment_status: 'Unpaid',
      product_id: resolvedSetId ? null : source.product_id,
      package_id: resolvedPackageId,
      set_id: resolvedSetId,
      landing_page_source_id: source.id,
    };

    const { data: order, error: insertError } = await supabaseAdmin.from('orders').insert(orderPayload).select().single();

    if (insertError) {
      await logIntake({
        success: false, status_code: 500, error_reason: `Insert failed: ${insertError.message}`,
        source_id: source.id, api_key_used: api_key, content_type: contentType, parse_method: parseMethod,
        raw_body: rawText, parsed_body: body, resolved_fields: resolvedFields,
      });
      return NextResponse.json({ success: false, error: 'Unable to create the order right now.' }, { status: 500 });
    }

    await supabaseAdmin
      .from('landing_page_sources')
      .update({ last_used_at: new Date().toISOString(), total_orders_received: (source.total_orders_received || 0) + 1 })
      .eq('id', source.id);

    await logIntake({
      success: true, status_code: 200, source_id: source.id, api_key_used: api_key,
      content_type: contentType, parse_method: parseMethod, resolved_fields: resolvedFields, order_id: order.id,
      raw_body: rawText, parsed_body: body,
    });

    // Orders from this route arrive with nobody's browser necessarily open —
    // unlike an order typed into the dashboard, there's no logged-in session
    // to piggyback a client-side notification on. So confirmation + alerting
    // has to happen right here, server-side, or it may never happen at all.
    try {
      const { sms, whatsapp } = await getAutoConfirmSettings(supabaseAdmin);
      if (order.phone && (sms || whatsapp)) {
        await sendOrderConfirmationMessages(supabaseAdmin, {
          phone: order.phone, customerName: order.customer, orderId: order.id, itemLabel,
          sendSms: sms, sendWhatsapp: whatsapp,
        });
      }
    } catch (e) {
      console.error('[order-intake] auto-confirmation failed:', e.message);
    }

    try {
      const notifyIds = await getOrderNotifyRecipients(supabaseAdmin);
      if (notifyIds.length > 0) {
        await notifyUsersServer(supabaseAdmin, {
          userIds: notifyIds, type: 'new_order', orderId: order.id,
          title: 'New order', body: `${order.customer}${order.state ? ' · ' + order.state : ''}`,
        });
      }
    } catch (e) {
      console.error('[order-intake] admin/staff notify failed:', e.message);
    }

    return NextResponse.json({
      success: true,
      order_id: order.id,
      serial_number: order.serial_number,
    });
  } catch (e) {
    console.error('[order-intake] unexpected error processing request:', e);
    await logIntake({
      success: false, status_code: 500, error_reason: `Unexpected error: ${e.message}`,
      source_id: source && source.id, api_key_used: api_key, content_type: contentType, parse_method: parseMethod,
      raw_body: rawText, parsed_body: body,
    });
    return NextResponse.json({ success: false, error: 'Unable to process request right now.' }, { status: 500 });
  }
}
