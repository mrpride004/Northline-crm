'use client';
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { STATUSES, logEvent, orderTotal, sendConfirmation, forwardToDispatchCompany, ReportsPage, InventoryPage, OrderHistoryModal, CustomerHistoryModal, NotificationsBell, NIGERIA_STATES, AgentStockPage, MyStockPage, ConfirmOrderModal, SettingsPage, SubmitterView, ProductPackagesModal, StatusRemarkModal } from './features';

export default function Dashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [agentStock, setAgentStock] = useState([]);
  const [settings, setSettings] = useState({});
  const [dispatchCompanies, setDispatchCompanies] = useState([]);
  const [packages, setPackages] = useState([]);
  const [latestRemarks, setLatestRemarks] = useState({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!s) { router.replace('/login'); return; }
      setSession(s);
      const { data: p } = await supabase.from('profiles').select('*').eq('id', s.user.id).single();
      setProfile(p);
      await refreshAll();
      setLoading(false);
    })();
  }, []);

  async function refreshAll() {
    const [{ data: prod }, { data: ord }, { data: profs }, { data: stock }, { data: settingsRows }, { data: companies }, { data: pkgs }, { data: events }] = await Promise.all([
      supabase.from('products').select('*').order('created_at'),
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*'),
      supabase.from('agent_stock').select('*'),
      supabase.from('app_settings').select('*'),
      supabase.from('dispatch_companies').select('*').eq('active', true),
      supabase.from('product_packages').select('*'),
      supabase.from('order_events').select('*').eq('event_type', 'remark').order('created_at', { ascending: false }).limit(500),
    ]);
    setProducts(prod || []);
    setOrders(ord || []);
    setProfiles(profs || []);
    setAgentStock(stock || []);
    const settingsMap = {};
    (settingsRows || []).forEach(r => { settingsMap[r.key] = r.value; });
    setSettings(settingsMap);
    setDispatchCompanies(companies || []);
    setPackages(pkgs || []);
    const remarkMap = {};
    (events || []).forEach(e => {
      if (!remarkMap[e.order_id]) remarkMap[e.order_id] = e; // first hit per order = most recent, since already sorted desc
    });
    setLatestRemarks(remarkMap);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (loading) return <div className="loading">Loading your workspace…</div>;
  if (!profile) return <div className="loading">Your account has no role assigned yet. Ask your admin to set one in Supabase.</div>;

  const isAdmin = profile.role === 'admin';
  const isSubmitter = ['manager', 'logistics', 'marketer'].includes(profile.role);
  const isInventoryManager = profile.role === 'inventory';
  const myOrders = isAdmin ? orders
    : profile.role === 'staff' ? orders.filter(o => o.staff_id === profile.id)
    : profile.role === 'dispatch' ? orders.filter(o => o.dispatch_id === profile.id)
    : orders.filter(o => o.created_by === profile.id);

  const roleLabel = { admin: 'Admin', staff: 'Staff', dispatch: 'Dispatch partner', manager: 'Manager', logistics: 'Logistics Manager', marketer: 'Marketer', inventory: 'Inventory Manager' }[profile.role] || profile.role;

  const navItems = isAdmin ? [
    { key: 'dashboard', label: 'Overview' },
    { key: 'orders', label: 'All orders', count: orders.length },
    { key: 'products', label: 'Products' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'agentstock', label: 'Agent stock' },
    { key: 'team', label: 'Team' },
    { key: 'reports', label: 'Reports' },
    { key: 'settings', label: 'Settings' },
  ] : profile.role === 'staff' ? [
    { key: 'dashboard', label: 'My orders', count: myOrders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled').length },
    ...(profile.active ? [{ key: 'unassigned', label: 'Unassigned pool', count: orders.filter(o => !o.staff_id).length }] : []),
  ] : profile.role === 'dispatch' ? [
    { key: 'dashboard', label: 'My deliveries', count: myOrders.filter(o => o.status === 'Dispatched').length },
    { key: 'mystock', label: 'My stock' },
  ] : isInventoryManager ? [
    { key: 'dashboard', label: 'Inventory' },
    { key: 'agentstock', label: 'Agent stock' },
  ] : [
    { key: 'dashboard', label: 'Submit orders' },
  ];

  return (
    <div className="app">
      <div className={'mobile-backdrop' + (mobileMenuOpen ? ' mobile-open' : '')} onClick={() => setMobileMenuOpen(false)} />
      <div className={'sidebar' + (mobileMenuOpen ? ' mobile-open' : '')}>
        <div className="brand">
          <p className="brand-name">Northline</p>
          <div className="brand-role">{profile.full_name} · {roleLabel}</div>
        </div>
        <div className="nav">
          {navItems.map(n => (
            <div key={n.key} className={'nav-item' + (page === n.key ? ' active' : '')} onClick={() => { setPage(n.key); setMobileMenuOpen(false); }}>
              <span>{n.label}</span>
              {n.count > 0 && <span className="nav-count">{n.count}</span>}
            </div>
          ))}
        </div>
        <div className="sidebar-foot">
          <NotificationsBell profile={profile} isAdmin={isAdmin} />
          <button className="switch-out" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <div className="main">
        <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)}>☰</button>
        {isAdmin && page === 'dashboard' && <AdminOverview orders={orders} products={products} profiles={profiles} />}
        {isAdmin && page === 'orders' && <OrdersPage orders={orders} products={products} profiles={profiles} isAdmin profile={profile} settings={settings} dispatchCompanies={dispatchCompanies} packages={packages} latestRemarks={latestRemarks} refresh={refreshAll} />}
        {isAdmin && page === 'products' && <ProductsPage products={products} orders={orders} packages={packages} refresh={refreshAll} />}
        {isAdmin && page === 'inventory' && <InventoryPage products={products} orders={orders} refresh={refreshAll} />}
        {isAdmin && page === 'agentstock' && <AgentStockPage profiles={profiles} products={products} agentStock={agentStock} refresh={refreshAll} />}
        {isAdmin && page === 'team' && <TeamPage profiles={profiles} orders={orders} products={products} session={session} refresh={refreshAll} />}
        {isAdmin && page === 'reports' && <ReportsPage orders={orders} profiles={profiles} session={session} />}
        {isAdmin && page === 'settings' && <SettingsPage settings={settings} refresh={refreshAll} />}

        {profile.role === 'staff' && page === 'dashboard' && <OrdersPage orders={myOrders} products={products} profiles={profiles} title="My orders" myId={profile.id} myRole="staff" profile={profile} settings={settings} dispatchCompanies={dispatchCompanies} packages={packages} latestRemarks={latestRemarks} refresh={refreshAll} />}
        {profile.role === 'staff' && page === 'unassigned' && <UnassignedPage orders={orders.filter(o => !o.staff_id)} products={products} myId={profile.id} profile={profile} refresh={refreshAll} />}

        {profile.role === 'dispatch' && page === 'dashboard' && <DispatchPage orders={myOrders} products={products} packages={packages} latestRemarks={latestRemarks} profile={profile} refresh={refreshAll} />}
        {profile.role === 'dispatch' && page === 'mystock' && <MyStockPage profile={profile} agentStock={agentStock} products={products} />}

        {isSubmitter && page === 'dashboard' && <SubmitterView profile={profile} products={products} orders={orders} refresh={refreshAll} />}

        {isInventoryManager && page === 'dashboard' && <InventoryPage products={products} orders={orders} refresh={refreshAll} />}
        {isInventoryManager && page === 'agentstock' && <AgentStockPage profiles={profiles} products={products} agentStock={agentStock} refresh={refreshAll} />}
      </div>
    </div>
  );
}

function AdminOverview({ orders, products, profiles }) {
  const active = orders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled').length;
  const delivered = orders.filter(o => o.status === 'Delivered').length;
  const unassigned = orders.filter(o => !o.staff_id).length;
  const staffList = profiles.filter(p => p.role !== 'admin');

  return (
    <div>
      <div className="topbar">
        <div><h1 className="page-title">Overview</h1><p className="page-sub">Everything moving across all products, right now.</p></div>
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-num">{orders.length}</div><div className="stat-label">Total orders</div></div>
        <div className="stat"><div className="stat-num">{active}</div><div className="stat-label">In progress</div></div>
        <div className="stat"><div className="stat-num">{delivered}</div><div className="stat-label">Delivered</div></div>
        <div className="stat"><div className="stat-num">{unassigned}</div><div className="stat-label">Unassigned</div></div>
      </div>
      <div className="row2" style={{ gap: '16px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontFamily: 'Georgia,serif', fontSize: '16px', marginBottom: '10px' }}>By product</h3>
          <div className="list-manage">
            {products.map(p => (
              <div key={p.id} className="list-manage-row"><span>{p.name}</span><span style={{ color: '#8A93A0' }}>{orders.filter(o => o.product_id === p.id).length} orders</span></div>
            ))}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontFamily: 'Georgia,serif', fontSize: '16px', marginBottom: '10px' }}>Team</h3>
          <div className="list-manage">
            {staffList.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No staff or dispatch partners added yet</div>}
            {staffList.map(s => {
              const load = orders.filter(o => (s.role === 'staff' ? o.staff_id : o.dispatch_id) === s.id && o.status !== 'Delivered' && o.status !== 'Cancelled').length;
              return <div key={s.id} className="list-manage-row"><span>{s.full_name} <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>({s.role})</span></span><span style={{ color: '#8A93A0' }}>{load} active</span></div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderModal({ products, packages, profiles, order, onSave, onClose }) {
  const [productId, setProductId] = useState(order ? order.product_id : (products[0] ? products[0].id : ''));
  const [customer, setCustomer] = useState(order ? order.customer : '');
  const [phone, setPhone] = useState(order ? order.phone : '');
  const [address, setAddress] = useState(order ? order.address : '');
  const [notes, setNotes] = useState(order ? order.notes : '');
  const [quantity, setQuantity] = useState(order ? order.quantity || 1 : 1);
  const [unitPrice, setUnitPrice] = useState(order ? order.unit_price ?? '' : '');
  const [deliveryFee, setDeliveryFee] = useState(order ? order.delivery_fee ?? 0 : 0);
  const [paymentStatus, setPaymentStatus] = useState(order ? order.payment_status || 'Unpaid' : 'Unpaid');
  const [rescheduleDate, setRescheduleDate] = useState(order ? order.reschedule_date || '' : '');
  const [priority, setPriority] = useState(order ? order.priority || 'Normal' : 'Normal');
  const [preferredTime, setPreferredTime] = useState(order ? order.preferred_time || '' : '');
  const [packageId, setPackageId] = useState(order ? order.package_id || '' : '');
  const [giftQuantity, setGiftQuantity] = useState(order ? order.gift_quantity || 0 : 0);
  const [state, setState] = useState(order ? order.state || '' : '');
  const [dispatchId, setDispatchId] = useState(order ? order.dispatch_id || '' : '');

  const productPackages = (packages || []).filter(p => p.product_id === productId);
  const selectedPackage = productPackages.find(p => p.id === packageId);
  const giftProduct = selectedPackage ? products.find(p => p.id === selectedPackage.gift_product_id) : null;
  const dispatchInState = (profiles || []).filter(p => p.role === 'dispatch' && p.active && state && p.state === state);
  const otherDispatch = (profiles || []).filter(p => p.role === 'dispatch' && p.active && (!state || p.state !== state));

  function onPackageChange(id) {
    setPackageId(id);
    const pkg = productPackages.find(p => p.id === id);
    setGiftQuantity(pkg && pkg.gift_product_id ? pkg.gift_quantity : 0);
    if (pkg && pkg.price != null) setUnitPrice(pkg.price);
  }

  function save() {
    if (!customer.trim() || !productId) return;
    onSave({
      product_id: productId, customer: customer.trim(), phone: phone.trim(), address: address.trim(), notes: notes.trim(),
      quantity: parseInt(quantity, 10) || 1,
      unit_price: unitPrice === '' ? null : parseFloat(unitPrice),
      delivery_fee: parseFloat(deliveryFee) || 0,
      payment_status: paymentStatus,
      reschedule_date: rescheduleDate || null,
      priority, preferred_time: preferredTime.trim(),
      package_id: giftProduct ? (packageId || null) : null,
      gift_quantity: giftProduct ? (parseInt(giftQuantity, 10) || 0) : 0,
      state: state || null,
      dispatch_id: dispatchId || null,
    });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{order ? 'Edit order' : 'New order'}</h3>
        <label>Product</label>
        <select value={productId} onChange={e => { setProductId(e.target.value); setPackageId(''); setGiftQuantity(0); }}>
          {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.stock_quantity ?? 0} in stock)</option>)}
        </select>
        {productPackages.length > 0 && (
          <>
            <label>Package</label>
            <select value={packageId} onChange={e => onPackageChange(e.target.value)}>
              <option value="">— No package (just the product) —</option>
              {productPackages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        )}
        <label>Customer name</label>
        <input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Full name" />
        <label>Phone</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="080..." />
        <div className="row2">
          <div><label>Quantity</label><input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></div>
          <div><label>Unit price (₦)</label><input type="number" min="0" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="0" /></div>
        </div>
        <div className="row2">
          <div><label>Delivery fee (₦)</label><input type="number" min="0" value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)} /></div>
          <div><label>Payment status</label>
            <select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}>
              <option value="Unpaid">Unpaid</option>
              <option value="Partial">Partial</option>
              <option value="Paid">Paid</option>
            </select>
          </div>
        </div>
        {giftProduct && (
          <>
            <label>Free gift: {giftProduct.name} ({giftProduct.stock_quantity ?? 0} in stock) — quantity to send</label>
            <input type="number" min="0" value={giftQuantity} onChange={e => setGiftQuantity(e.target.value)} placeholder="0" />
          </>
        )}
        <label>Delivery address</label>
        <textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, city, landmark" />
        <label>Delivery state</label>
        <select value={state} onChange={e => setState(e.target.value)}>
          <option value="">— Select state —</option>
          {NIGERIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {profiles && (
          <>
            <label>Assign dispatch partner (optional)</label>
            <select value={dispatchId} onChange={e => setDispatchId(e.target.value)}>
              <option value="">— Unassigned —</option>
              {dispatchInState.length > 0 && (
                <optgroup label={`In ${state}`}>
                  {dispatchInState.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </optgroup>
              )}
              <optgroup label={dispatchInState.length > 0 ? 'Other states' : 'All dispatch partners'}>
                {otherDispatch.map(d => <option key={d.id} value={d.id}>{d.full_name}{d.state ? ` · ${d.state}` : ''}</option>)}
              </optgroup>
            </select>
          </>
        )}
        <div className="row2">
          <div><label>Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}>
              <option value="Normal">Normal</option>
              <option value="High">High priority</option>
            </select>
          </div>
          <div><label>Preferred time</label><input value={preferredTime} onChange={e => setPreferredTime(e.target.value)} placeholder="e.g. After 5pm" /></div>
        </div>
        <label>Reschedule date (only if rescheduling)</label>
        <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} />
        <label>Notes (optional)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} />
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>{order ? 'Save changes' : 'Create order'}</button>
        </div>
      </div>
    </div>
  );
}

function AssignModal({ order, profiles, onSave, onClose }) {
  const [staffId, setStaffId] = useState(order.staff_id || '');
  const [dispatchId, setDispatchId] = useState(order.dispatch_id || '');
  const staffList = profiles.filter(p => p.role === 'staff' && p.active);
  const dispatchList = profiles.filter(p => p.role === 'dispatch' && p.active)
    .sort((a, b) => {
      const aMatch = order.state && a.state === order.state ? 0 : 1;
      const bMatch = order.state && b.state === order.state ? 0 : 1;
      return aMatch - bMatch;
    });
  const matchCount = order.state ? dispatchList.filter(d => d.state === order.state).length : 0;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Assign order</h3>
        <label>Staff member</label>
        <select value={staffId} onChange={e => setStaffId(e.target.value)}>
          <option value="">— Unassigned —</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <label>Dispatch partner{order.state ? ` — ${matchCount} in ${order.state}` : ''}</label>
        <select value={dispatchId} onChange={e => setDispatchId(e.target.value)}>
          <option value="">— Unassigned —</option>
          {dispatchList.map(s => (
            <option key={s.id} value={s.id}>
              {s.full_name}{s.state ? ` · ${s.state}` : ' · no state set'}{order.state && s.state === order.state ? ' ✓ matches order' : ''}
            </option>
          ))}
        </select>
        {!order.state && <p style={{ fontSize: '11.5px', color: '#8A93A0', marginTop: '6px' }}>This order has no delivery state set, so agents aren't filtered by location. Edit the order to add one.</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSave({ staff_id: staffId || null, dispatch_id: dispatchId || null })}>Save</button>
        </div>
      </div>
    </div>
  );
}

function OrdersPage({ orders, products, profiles, isAdmin, title, myId, myRole, profile, settings, dispatchCompanies, packages, latestRemarks, refresh }) {
  const [activeProduct, setActiveProduct] = useState('all');
  const [activeState, setActiveState] = useState('all');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [historyOrder, setHistoryOrder] = useState(null);
  const [customerView, setCustomerView] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [forwarding, setForwarding] = useState(null);
  const [statusChanging, setStatusChanging] = useState(null);

  const byProduct = activeProduct === 'all' ? orders : orders.filter(o => o.product_id === activeProduct);
  const byState = activeState === 'all' ? byProduct : byProduct.filter(o => o.state === activeState);
  const filtered = search.trim()
    ? byState.filter(o => {
        const q = search.trim().toLowerCase();
        return o.id.toLowerCase().includes(q) || (o.customer || '').toLowerCase().includes(q) || (o.phone || '').toLowerCase().includes(q);
      })
    : byState;
  const usedStates = [...new Set(orders.map(o => o.state).filter(Boolean))].sort();
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  const staffName = id => (profiles.find(s => s.id === id) || {}).full_name || '—';

  function exportCSV() {
    const headers = ['Order ID', 'Product', 'Customer', 'Phone', 'State', 'Address', 'Quantity', 'Unit Price', 'Delivery Fee', 'Payment Status', 'Status', 'Priority', 'Preferred Time', 'Assigned Staff', 'Assigned Dispatch', 'Created At', 'Delivered At'];
    const rows = filtered.map(o => [
      o.id, prodName(o.product_id), o.customer, o.phone, o.state || '', (o.address || '').replace(/\n/g, ' '),
      o.quantity || 1, o.unit_price ?? '', o.delivery_fee ?? 0, o.payment_status || '', o.status,
      o.priority || '', o.preferred_time || '', staffName(o.staff_id), staffName(o.dispatch_id),
      o.created_at, o.delivered_at || '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    const stateLabel = activeState === 'all' ? 'all-states' : activeState.replace(/\s+/g, '-');
    a.href = url;
    a.download = `orders-backup-${stateLabel}-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function createOrder(fields) {
    const { data, error } = await supabase.from('orders').insert(fields).select().single();
    setShowNew(false);
    if (!error && data) {
      await logEvent({ order_id: data.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'created', note: 'Order created' });
      if (data.phone && (settings?.sms_auto_confirm === 'true' || settings?.whatsapp_auto_confirm === 'true')) {
        sendConfirmation({
          phone: data.phone, customerName: data.customer, orderId: data.id,
          sendSms: settings?.sms_auto_confirm === 'true',
          sendWhatsapp: settings?.whatsapp_auto_confirm === 'true',
        });
      }
    }
    refresh();
  }

  async function adjustStockForOrder(o, direction) {
    // direction: -1 to deduct (delivering), +1 to add back (reversing a delivered order)
    const qtyDelta = direction * (o.quantity || 1);
    const product = products.find(p => p.id === o.product_id);
    if (product) {
      await supabase.rpc('adjust_stock', { p_product_id: product.id, p_delta: qtyDelta });
      if (o.dispatch_id) {
        await supabase.rpc('adjust_agent_stock', { p_agent_id: o.dispatch_id, p_product_id: product.id, p_delta: qtyDelta });
      }
    }
    if (o.package_id && o.gift_quantity > 0) {
      const pkg = (packages || []).find(p => p.id === o.package_id);
      if (pkg && pkg.gift_product_id) {
        const giftDelta = direction * o.gift_quantity;
        await supabase.rpc('adjust_stock', { p_product_id: pkg.gift_product_id, p_delta: giftDelta });
        if (o.dispatch_id) {
          await supabase.rpc('adjust_agent_stock', { p_agent_id: o.dispatch_id, p_product_id: pkg.gift_product_id, p_delta: giftDelta });
        }
      }
    }
  }

  async function updateOrder(id, patch, meta, remark) {
    const current = orders.find(o => o.id === id);
    if (patch.status === 'Delivered') {
      patch.delivered_at = new Date().toISOString();
      if (current && current.status !== 'Delivered') await adjustStockForOrder(current, -1);
    }
    if (patch.status === 'Cancelled' && current && current.status === 'Delivered') {
      await adjustStockForOrder(current, 1);
    }
    await supabase.from('orders').update(patch).eq('id', id);
    if (patch.status && current && patch.status !== current.status) {
      await logEvent({ order_id: id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'status_change', from_status: current.status, to_status: patch.status });
      if (patch.status === 'Cancelled' && current.status === 'Delivered') {
        await logEvent({ order_id: id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: 'Order reversed from Delivered — stock added back to inventory.' });
      }
    }
    if (remark && remark.trim()) {
      await logEvent({ order_id: id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: remark.trim() });
    }
    if (meta === 'assigned') {
      await logEvent({ order_id: id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'assigned', note: 'Assignment updated' });
    }
    refresh();
  }

  async function markPaid(o) {
    await supabase.from('orders').update({ payment_status: 'Paid' }).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: 'Payment confirmed — marked as Paid.' });
    refresh();
  }

  async function copyTrackingLink(orderId) {
    const link = `${window.location.origin}/track/${orderId}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch (e) { console.error('Copy failed', e); }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1 className="page-title">{title || 'All orders'}</h1>
          <p className="page-sub">{filtered.length} order{filtered.length !== 1 ? 's' : ''}{activeProduct !== 'all' ? ' · ' + prodName(activeProduct) : ''}{activeState !== 'all' ? ' · ' + activeState : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isAdmin && usedStates.length > 0 && (
            <select className="status-sel" value={activeState} onChange={e => setActiveState(e.target.value)}>
              <option value="all">All states</option>
              {usedStates.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {isAdmin && filtered.length > 0 && <button className="btn" onClick={exportCSV}>⬇ Export backup (CSV)</button>}
          {(isAdmin || myRole === 'staff') && <button className="btn primary" onClick={() => setShowNew(true)}>+ New order</button>}
        </div>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Quick find: order ID, customer name, or phone…"
          style={{ width: '100%', maxWidth: '420px', padding: '9px 12px', border: '1px solid #DEDAD0', borderRadius: '6px', fontSize: '13.5px' }}
        />
      </div>

      {products.length > 0 &&
        <div className="product-tabs">
          <span className={'ptab' + (activeProduct === 'all' ? ' active' : '')} onClick={() => setActiveProduct('all')}>All products</span>
          {products.map(p => <span key={p.id} className={'ptab' + (activeProduct === p.id ? ' active' : '')} onClick={() => setActiveProduct(p.id)}>{p.name}</span>)}
        </div>}

      {filtered.length === 0 ? (
        <div className="empty">No orders here yet.</div>
      ) : (
        <table>
          <thead><tr><th>Order</th><th>Product</th><th>Customer</th><th>Payment</th><th>Assigned to</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {filtered.map(o => (
              <tr key={o.id}>
                <td className="oid">{o.id.slice(0, 8)}</td>
                <td>{prodName(o.product_id)} <span style={{ color: '#8A93A0', fontSize: '11px' }}>×{o.quantity || 1}</span></td>
                <td>
                  <span className="link-btn" onClick={() => setCustomerView(o)}>{o.customer}</span>
                  <div style={{ fontSize: '11px', color: '#8A93A0' }}>{o.phone}{o.state ? ` · ${o.state}` : ''}</div>
                </td>
                <td style={{ fontSize: '12px' }}>
                  <span className={'pill ' + (o.payment_status === 'Paid' ? 'Delivered' : o.payment_status === 'Partial' ? 'Preparing' : 'Cancelled')}>{o.payment_status || 'Unpaid'}</span>
                  {isAdmin && <div style={{ color: '#8A93A0', marginTop: '3px' }}>₦{orderTotal(o).toLocaleString()}</div>}
                  {isAdmin && o.payment_status !== 'Paid' && <div><button className="link-btn" onClick={() => markPaid(o)} style={{ fontSize: '11px' }}>Mark Paid</button></div>}
                </td>
                <td style={{ fontSize: '12px' }}>
                  {o.staff_id ? staffName(o.staff_id) : <span style={{ color: '#B0483F' }}>Unassigned staff</span>}
                  {o.dispatch_id ? <div style={{ color: '#8A93A0' }}>{staffName(o.dispatch_id)}</div> : null}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isAdmin || (myRole === 'staff' && o.staff_id === myId) ? (
                      <select className="status-sel" value={o.status} onChange={e => setStatusChanging({ order: o, newStatus: e.target.value })}>
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <span className={'pill ' + o.status}>{o.status}</span>}
                    {o.priority === 'High' && <span className="pill Cancelled">High</span>}
                  </div>
                  {o.status === 'Rescheduled' && o.reschedule_date && <div style={{ fontSize: '10.5px', color: '#8A93A0', marginTop: '3px' }}>→ {o.reschedule_date}</div>}
                  {o.preferred_time && <div style={{ fontSize: '10.5px', color: '#8A93A0', marginTop: '3px' }}>⏰ {o.preferred_time}</div>}
                  {latestRemarks && latestRemarks[o.id] && (
                    <div style={{ fontSize: '10.5px', color: '#4B5566', marginTop: '4px', maxWidth: '200px', fontStyle: 'italic' }}>
                      💬 {latestRemarks[o.id].note} <span style={{ color: '#8A93A0' }}>— {latestRemarks[o.id].actor_name || 'System'}</span>
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {(isAdmin || (myRole === 'staff' && (o.staff_id === myId || !o.staff_id))) && o.status === 'New' && <><button className="link-btn" onClick={() => setConfirming(o)}>Confirm</button>{' · '}</>}
                  <button className="link-btn" onClick={() => setHistoryOrder(o)}>History</button>{' · '}
                  <button className="link-btn" onClick={() => copyTrackingLink(o.id)}>Copy tracking link</button>{' · '}
                  {isAdmin && o.phone && <>
                    <button className="link-btn" onClick={() => sendConfirmation({ phone: o.phone, customerName: o.customer, orderId: o.id, sendSms: true, sendWhatsapp: true })}>Send confirmation</button>{' · '}
                  </>}
                  {isAdmin && dispatchCompanies && dispatchCompanies.length > 0 && <>
                    <button className="link-btn" onClick={() => setForwarding(o)}>Forward</button>{' · '}
                  </>}
                  {isAdmin && <>
                    <button className="link-btn" onClick={() => setAssigning(o)}>Assign</button>{' · '}
                  </>}
                  {(isAdmin || (myRole === 'staff' && o.staff_id === myId)) && <button className="link-btn" onClick={() => setEditing(o)}>Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && <OrderModal products={products} packages={packages} profiles={isAdmin ? profiles : null} onClose={() => setShowNew(false)} onSave={createOrder} />}
      {editing && <OrderModal products={products} packages={packages} profiles={isAdmin ? profiles : null} order={editing} onClose={() => setEditing(null)} onSave={(fields) => { updateOrder(editing.id, fields); setEditing(null); }} />}
      {assigning && <AssignModal order={assigning} profiles={profiles} onClose={() => setAssigning(null)} onSave={(patch) => { updateOrder(assigning.id, patch, 'assigned'); setAssigning(null); }} />}
      {historyOrder && <OrderHistoryModal order={historyOrder} profile={profile} onClose={() => setHistoryOrder(null)} onLogged={refresh} />}
      {customerView && <CustomerHistoryModal phone={customerView.phone} customer={customerView.customer} orders={orders} products={products} onClose={() => setCustomerView(null)} />}
      {confirming && <ConfirmOrderModal order={confirming} profile={profile} onClose={() => setConfirming(null)} onConfirmed={() => { setConfirming(null); refresh(); }} />}
      {forwarding && (
        <ForwardModal
          order={forwarding} products={products} companies={dispatchCompanies || []}
          onClose={() => setForwarding(null)}
          onSent={async (companyId) => {
            await updateOrder(forwarding.id, { forwarded_to: companyId });
            await logEvent({ order_id: forwarding.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: 'Order forwarded to external dispatch company' });
            setForwarding(null);
          }}
        />
      )}
      {statusChanging && (
        <StatusRemarkModal
          order={statusChanging.order} newStatus={statusChanging.newStatus}
          onClose={() => setStatusChanging(null)}
          onConfirm={({ remark, fee, rescheduleDate }) => {
            const patch = { status: statusChanging.newStatus };
            if (statusChanging.newStatus === 'Delivered') patch.delivery_fee = fee;
            if (statusChanging.newStatus === 'Rescheduled') patch.reschedule_date = rescheduleDate || null;
            updateOrder(statusChanging.order.id, patch, null, remark);
            setStatusChanging(null);
          }}
        />
      )}
    </div>
  );
}

function ForwardModal({ order, products, companies, onClose, onSent }) {
  const [companyId, setCompanyId] = useState(companies[0] ? companies[0].id : '');
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';

  async function send() {
    const company = companies.find(c => c.id === companyId);
    if (!company) return;
    const summary = `Order ${order.id.slice(0, 8)} · ${prodName(order.product_id)} × ${order.quantity || 1}\nCustomer: ${order.customer} (${order.phone})\nAddress: ${order.address || '—'}${order.preferred_time ? `\nPreferred time: ${order.preferred_time}` : ''}${order.priority === 'High' ? '\nPRIORITY: HIGH' : ''}`;
    await forwardToDispatchCompany({ phone: company.phone, channel: company.channel, orderSummary: summary });
    onSent(companyId);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Forward to external dispatch</h3>
        <label style={{ marginTop: 0 }}>Company</label>
        <select value={companyId} onChange={e => setCompanyId(e.target.value)}>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name} · {c.channel}</option>)}
        </select>
        <p style={{ fontSize: '12px', color: '#8A93A0', marginTop: '10px' }}>
          Sends the order details to {companies.find(c => c.id === companyId)?.contact_name || 'their contact'} for them to relay to their team.
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={send}>Send</button>
        </div>
      </div>
    </div>
  );
}

function UnassignedPage({ orders, products, myId, profile, refresh }) {
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  async function claim(o) {
    await supabase.from('orders').update({ staff_id: myId }).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'assigned', note: `${profile?.full_name || 'A staff member'} claimed this order` });
    refresh();
  }
  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Unassigned pool</h1><p className="page-sub">Orders no staff member has picked up yet.</p></div></div>
      {orders.length === 0 ? <div className="empty">Nothing waiting — the queue is clear.</div> : (
        <table>
          <thead><tr><th>Order</th><th>Product</th><th>Customer</th><th></th></tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td className="oid">{o.id.slice(0, 8)}</td>
                <td>{prodName(o.product_id)}</td>
                <td>{o.customer}</td>
                <td style={{ textAlign: 'right' }}><button className="btn primary" onClick={() => claim(o)}>Claim</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DeliveryFeeCell({ order, onSave }) {
  const [value, setValue] = useState(order.delivery_fee || '');
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div>
        <span style={{ fontSize: '13px' }}>₦{Number(order.delivery_fee || 0).toLocaleString()}</span>{' '}
        <button className="link-btn" onClick={() => setEditing(true)} style={{ fontSize: '11px' }}>Edit</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <input
        type="number" min="0" value={value} onChange={e => setValue(e.target.value)}
        style={{ width: '90px', padding: '5px 8px', border: '1px solid #DEDAD0', borderRadius: '4px', fontSize: '12px' }}
        autoFocus
      />
      <button className="link-btn" onClick={() => { onSave(value); setEditing(false); }} style={{ fontSize: '11px' }}>Save</button>
      <button className="link-btn" onClick={() => setEditing(false)} style={{ fontSize: '11px' }}>Cancel</button>
    </div>
  );
}

function DispatchPage({ orders, products, packages, latestRemarks, profile, refresh }) {
  const [confirming, setConfirming] = useState(null);
  const [statusChanging, setStatusChanging] = useState(null);
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  const pkgName = id => (packages || []).find(p => p.id === id)?.name || null;
  const giftName = pkgId => {
    const pkg = (packages || []).find(p => p.id === pkgId);
    if (!pkg || !pkg.gift_product_id) return null;
    return products.find(p => p.id === pkg.gift_product_id)?.name || null;
  };

  async function deductStockForDelivery(o) {
    const product = products.find(p => p.id === o.product_id);
    if (product) {
      await supabase.rpc('adjust_stock', { p_product_id: product.id, p_delta: -(o.quantity || 1) });
      if (o.dispatch_id) {
        await supabase.rpc('adjust_agent_stock', { p_agent_id: o.dispatch_id, p_product_id: product.id, p_delta: -(o.quantity || 1) });
      }
    }
    if (o.package_id && o.gift_quantity > 0) {
      const pkg = (packages || []).find(p => p.id === o.package_id);
      if (pkg && pkg.gift_product_id) {
        await supabase.rpc('adjust_stock', { p_product_id: pkg.gift_product_id, p_delta: -o.gift_quantity });
        if (o.dispatch_id) {
          await supabase.rpc('adjust_agent_stock', { p_agent_id: o.dispatch_id, p_product_id: pkg.gift_product_id, p_delta: -o.gift_quantity });
        }
      }
    }
  }

  async function applyStatusChange(o, status, { remark, fee, rescheduleDate } = {}) {
    const patch = { status };
    if (status === 'Delivered') {
      patch.delivered_at = new Date().toISOString();
      patch.delivery_fee = fee ?? 0;
      await deductStockForDelivery(o);
    }
    if (status === 'Rescheduled') patch.reschedule_date = rescheduleDate || null;
    await supabase.from('orders').update(patch).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'status_change', from_status: o.status, to_status: status });
    if (remark && remark.trim()) {
      await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: remark.trim() });
    }
    setStatusChanging(null);
    refresh();
  }

  async function markPaid(o) {
    await supabase.from('orders').update({ payment_status: 'Paid' }).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: 'Payment confirmed by dispatch — marked as Paid.' });
    refresh();
  }

  async function setDeliveryFee(o, fee) {
    const amount = parseFloat(fee) || 0;
    await supabase.from('orders').update({ delivery_fee: amount }).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: `Delivery fee set to ₦${amount.toLocaleString()} by dispatch.` });
    refresh();
  }

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">My deliveries</h1><p className="page-sub">Orders assigned to you for dispatch.</p></div></div>
      {orders.length === 0 ? <div className="empty">No deliveries assigned to you yet.</div> : (
        <table>
          <thead><tr><th>Order</th><th>Product & package</th><th>Customer</th><th>Address</th><th>Delivery fee</th><th>Status</th><th>Payment</th><th></th></tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td className="oid">{o.id.slice(0, 8)}</td>
                <td>
                  {prodName(o.product_id)} <span style={{ color: '#8A93A0', fontSize: '11px' }}>×{o.quantity || 1}</span>
                  {pkgName(o.package_id) && <div style={{ fontSize: '11px', color: '#8A93A0' }}>Package: {pkgName(o.package_id)}</div>}
                  {giftName(o.package_id) && <div style={{ fontSize: '11px', color: '#8A93A0' }}>🎁 {giftName(o.package_id)} × {o.gift_quantity}</div>}
                  {o.priority === 'High' && <span className="pill Cancelled" style={{ marginTop: '4px', display: 'inline-block' }}>High priority</span>}
                </td>
                <td>{o.customer}<div style={{ fontSize: '11px', color: '#8A93A0' }}>{o.phone}</div></td>
                <td style={{ fontSize: '12px', maxWidth: '220px' }}>
                  {o.address || '—'}
                  {o.preferred_time && <div style={{ fontSize: '10.5px', color: '#8A93A0', marginTop: '3px' }}>⏰ {o.preferred_time}</div>}
                </td>
                <td><DeliveryFeeCell order={o} onSave={(fee) => setDeliveryFee(o, fee)} /></td>
                <td>
                  <span className={'pill ' + o.status}>{o.status}</span>
                  {o.status === 'Rescheduled' && o.reschedule_date && <div style={{ fontSize: '10.5px', color: '#8A93A0', marginTop: '3px' }}>→ {o.reschedule_date}</div>}
                  {latestRemarks && latestRemarks[o.id] && (
                    <div style={{ fontSize: '10.5px', color: '#4B5566', marginTop: '4px', maxWidth: '180px', fontStyle: 'italic' }}>
                      💬 {latestRemarks[o.id].note} <span style={{ color: '#8A93A0' }}>— {latestRemarks[o.id].actor_name || 'System'}</span>
                    </div>
                  )}
                </td>
                <td>
                  <span className={'pill ' + (o.payment_status === 'Paid' ? 'Delivered' : 'Cancelled')}>{o.payment_status || 'Unpaid'}</span>
                  {o.payment_status !== 'Paid' && <div><button className="link-btn" onClick={() => markPaid(o)} style={{ fontSize: '11px' }}>Mark Paid</button></div>}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {o.status === 'New' && <><button className="link-btn" onClick={() => setConfirming(o)}>Confirm</button>{' · '}</>}
                  {o.status !== 'Delivered' && o.status !== 'Cancelled' && o.status !== 'New' && <>
                    <button className="btn primary" onClick={() => setStatusChanging({ order: o, newStatus: 'Delivered' })}>Delivered</button>{' '}
                    <button className="btn" onClick={() => setStatusChanging({ order: o, newStatus: 'Dispatched' })}>In Transit</button>{' '}
                    <button className="btn" onClick={() => setStatusChanging({ order: o, newStatus: 'Rescheduled' })}>Reschedule</button>{' '}
                    <button className="btn" onClick={() => setStatusChanging({ order: o, newStatus: 'Unreachable' })}>Unreachable</button>{' '}
                    <button className="btn" onClick={() => setStatusChanging({ order: o, newStatus: 'Cancelled' })}>Cancel</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirming && <ConfirmOrderModal order={confirming} profile={profile} onClose={() => setConfirming(null)} onConfirmed={() => { setConfirming(null); refresh(); }} />}
      {statusChanging && (
        <StatusRemarkModal
          order={statusChanging.order} newStatus={statusChanging.newStatus}
          onClose={() => setStatusChanging(null)}
          onConfirm={({ remark, fee, rescheduleDate }) => applyStatusChange(statusChanging.order, statusChanging.newStatus, { remark, fee, rescheduleDate })}
        />
      )}
    </div>
  );
}

function ProductsPage({ products, orders, packages, refresh }) {
  const [name, setName] = useState('');
  const [managingPackages, setManagingPackages] = useState(null);
  async function add() {
    if (!name.trim()) return;
    await supabase.from('products').insert({ name: name.trim() });
    setName('');
    refresh();
  }
  async function remove(id) {
    await supabase.from('products').delete().eq('id', id);
    refresh();
  }
  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Products</h1><p className="page-sub">Each product gets its own order queue and tab. Add packages to bundle a free gift with a product.</p></div></div>
      <div className="list-manage" style={{ marginBottom: '18px' }}>
        {products.map(p => {
          const pkgCount = (packages || []).filter(pk => pk.product_id === p.id).length;
          return (
            <div key={p.id} className="list-manage-row">
              <span>{p.name} <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>· {orders.filter(o => o.product_id === p.id).length} orders{pkgCount > 0 ? ` · ${pkgCount} package${pkgCount !== 1 ? 's' : ''}` : ''}</span></span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button className="link-btn" onClick={() => setManagingPackages(p)}>Manage packages</button>
                <button className="tiny-x" onClick={() => remove(p.id)}>Remove</button>
              </div>
            </div>
          );
        })}
        {products.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No products yet.</div>}
      </div>
      <div className="row2" style={{ maxWidth: '420px' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New product name" />
        <button className="btn primary" onClick={add} style={{ flex: '0 0 auto' }}>Add product</button>
      </div>
      {managingPackages && <ProductPackagesModal product={managingPackages} products={products} onClose={() => { setManagingPackages(null); refresh(); }} />}
    </div>
  );
}

function TeamPage({ profiles, orders, products, session, refresh }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [state, setState] = useState('');
  const [allowedProducts, setAllowedProducts] = useState([]);
  const [status, setStatus] = useState('');
  const [editingAccess, setEditingAccess] = useState(null);
  const staffList = profiles.filter(p => p.role !== 'admin');
  const isSubmitterRole = ['manager', 'logistics', 'marketer'].includes(role);

  function toggleProduct(id, list, setList) {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  }

  async function createLogin() {
    if (!name.trim() || !email.trim() || password.length < 6) {
      setStatus('Fill in a name, email, and a password of at least 6 characters.');
      return;
    }
    setStatus('Creating login…');
    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        full_name: name.trim(), email: email.trim(), password, role,
        state: role === 'dispatch' ? state : null,
        allowed_products: isSubmitterRole ? allowedProducts : null,
        username: username.trim() || null,
      }),
    });
    const body = await res.json();
    if (!res.ok) { setStatus(body.error || 'Something went wrong.'); return; }
    setStatus(`Login created for ${name.trim()}.`);
    setName(''); setUsername(''); setEmail(''); setPassword(''); setState(''); setAllowedProducts([]);
    refresh();
  }

  async function toggleActive(s) {
    await supabase.from('profiles').update({ active: !s.active }).eq('id', s.id);
    refresh();
  }

  async function saveAccess(id, list) {
    await supabase.from('profiles').update({ allowed_products: list }).eq('id', id);
    setEditingAccess(null);
    refresh();
  }

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Team</h1><p className="page-sub">Create a real login for each person — staff, dispatch, managers, or inventory. They can sign in with either their email or a username.</p></div></div>

      <div className="list-manage" style={{ marginBottom: '18px' }}>
        {staffList.map(s => {
          const load = orders.filter(o => (s.role === 'staff' ? o.staff_id : s.role === 'dispatch' ? o.dispatch_id : o.created_by) === s.id).length;
          const submitter = ['manager', 'logistics', 'marketer'].includes(s.role);
          return (
            <div key={s.id} className="list-manage-row">
              <span>{s.full_name} <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>({s.role}{s.state ? ` · ${s.state}` : ''}{s.username ? ` · @${s.username}` : ''}) · {load} orders</span>
                {!s.active && <span className="pill Cancelled" style={{ marginLeft: '8px' }}>Not receiving orders</span>}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                {submitter && <button className="link-btn" onClick={() => setEditingAccess(s)}>Edit product access</button>}
                <button className="btn" onClick={() => toggleActive(s)}>{s.active ? 'Receiving orders: On' : 'Receiving orders: Off'}</button>
              </div>
            </div>
          );
        })}
        {staffList.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No one added yet.</div>}
      </div>

      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '18px', maxWidth: '440px' }}>
        <label className="field-label" style={{ marginTop: 0 }}>Full name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Chidi Okafor" style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
        <label className="field-label">Email (their login)</label>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
        <label className="field-label">Username (optional — lets them sign in without typing the email)</label>
        <input value={username} onChange={e => setUsername(e.target.value.replace(/\s+/g, ''))} placeholder="e.g. chidi.o" style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
        <label className="field-label">Temporary password</label>
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
        <label className="field-label">Role</label>
        <select value={role} onChange={e => setRole(e.target.value)} style={{ width: '100%', marginBottom: '12px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }}>
          <option value="staff">Staff</option>
          <option value="dispatch">Dispatch partner</option>
          <option value="manager">Manager</option>
          <option value="logistics">Logistics Manager</option>
          <option value="marketer">Marketer</option>
          <option value="inventory">Inventory Manager</option>
        </select>
        {role === 'dispatch' && (
          <>
            <label className="field-label">State</label>
            <select value={state} onChange={e => setState(e.target.value)} style={{ width: '100%', marginBottom: '12px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }}>
              <option value="">— Select state —</option>
              {NIGERIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        )}
        {isSubmitterRole && (
          <>
            <label className="field-label">Which products can they submit orders for?</label>
            <div style={{ border: '1px solid #DEDAD0', borderRadius: '4px', padding: '8px', maxHeight: '140px', overflowY: 'auto', marginBottom: '12px' }}>
              {products.length === 0 && <p style={{ fontSize: '12px', color: '#8A93A0' }}>Add products first.</p>}
              {products.map(p => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '4px 2px' }}>
                  <input type="checkbox" checked={allowedProducts.includes(p.id)} onChange={() => toggleProduct(p.id, allowedProducts, setAllowedProducts)} />
                  {p.name}
                </label>
              ))}
            </div>
            <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '-8px', marginBottom: '12px' }}>Leave all unchecked to give access to every product.</p>
          </>
        )}
        <button className="btn primary" onClick={createLogin} style={{ width: '100%' }}>Create login</button>
        {status && <p style={{ fontSize: '12px', color: '#4B5566', marginTop: '10px' }}>{status}</p>}
      </div>

      {editingAccess && (
        <div className="overlay" onClick={() => setEditingAccess(null)}>
          <EditAccessModal person={editingAccess} products={products} onClose={() => setEditingAccess(null)} onSave={saveAccess} />
        </div>
      )}
    </div>
  );
}

function EditAccessModal({ person, products, onClose, onSave }) {
  const [list, setList] = useState(person.allowed_products || []);
  function toggle(id) { setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]); }
  return (
    <div className="modal" onClick={e => e.stopPropagation()}>
      <h3>Product access · {person.full_name}</h3>
      <div style={{ border: '1px solid #DEDAD0', borderRadius: '4px', padding: '8px', maxHeight: '220px', overflowY: 'auto' }}>
        {products.map(p => (
          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '5px 2px' }}>
            <input type="checkbox" checked={list.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.name}
          </label>
        ))}
      </div>
      <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '8px' }}>Leave all unchecked to give access to every product.</p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onSave(person.id, list)}>Save access</button>
      </div>
    </div>
  );
}
