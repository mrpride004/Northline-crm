import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Public endpoint — authenticated by api_key (per landing page), not a user session.
// Called by Zapier/Make/Pabbly whenever a WordPress form is submitted.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { api_key, customer, phone, phone2, address, state, selected_option, quantity, notes } = body;

  if (!api_key) return NextResponse.json({ success: false, error: 'Missing api_key.' }, { status: 401 });
  if (!customer || !phone) return NextResponse.json({ success: false, error: 'customer and phone are required.' }, { status: 400 });

  const { data: source, error: sourceError } = await supabaseAdmin
    .from('landing_page_sources')
    .select('*')
    .eq('api_key', api_key)
    .eq('active', true)
    .maybeSingle();

  if (sourceError || !source) {
    return NextResponse.json({ success: false, error: 'Invalid or inactive api_key.' }, { status: 401 });
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

  if (resolvedSetId) {
    const { data: set } = await supabaseAdmin.from('product_sets').select('*').eq('id', resolvedSetId).maybeSingle();
    if (set) {
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
    if (pkg && pkg.price != null) unitPrice = Number(pkg.price);
  } else if (source.product_id) {
    const { data: product } = await supabaseAdmin.from('products').select('*').eq('id', source.product_id).maybeSingle();
    if (product && product.default_price != null) unitPrice = Number(product.default_price);
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
    customer: customer.trim(),
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
    return NextResponse.json({ success: false, error: 'Unable to create the order right now.' }, { status: 500 });
  }

  await supabaseAdmin
    .from('landing_page_sources')
    .update({ last_used_at: new Date().toISOString(), total_orders_received: (source.total_orders_received || 0) + 1 })
    .eq('id', source.id);

  return NextResponse.json({
    success: true,
    order_id: order.id,
    serial_number: order.serial_number,
  });
}
