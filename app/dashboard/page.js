'use client';
import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { STATUSES, logEvent, orderTotal, sendConfirmation, forwardToDispatchCompany, ReportsPage, InventoryPage, OrderHistoryModal, CustomerHistoryModal, NotificationsBell, NIGERIA_STATES, AgentStockPage, MyStockPage, ConfirmOrderModal, SettingsPage, SubmitterView, ProductPackagesModal, StatusRemarkModal, copyToClipboard, buildOrderSummary, PersonDetailModal, CommissionRuleModal, CommissionPage, AdminCommissionPage, recordCommissionForOrder, reverseCommissionForOrder, recordFreeCommissionForOrder, statusRowColor, AddUpsellModal, RequestCorrectionModal, CorrectionsPage, UpsellRulesPage, UpsellsPage, SuspiciousActivityPage, getCurrentPackage, activeUpsellFor, showOrderAlert, playNotificationSound, enablePushNotifications, sendPushNotification } from './features';

const APP_SECTIONS = [
  { key: 'orders', label: 'All orders' },
  { key: 'products', label: 'Products' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'agentstock', label: 'Agent stock' },
  { key: 'team', label: 'Team' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
  { key: 'commission', label: 'Commission' },
  { key: 'upsellrules', label: 'Upsell Rules' },
  { key: 'corrections', label: 'Corrections' },
  { key: 'upsells', label: 'Upsells' },
  { key: 'suspicious', label: 'Suspicious Activity' },
];

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
  const [upsellsByOrder, setUpsellsByOrder] = useState({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState({});
  const [notifMsg, setNotifMsg] = useState('');
  const lastLocalActionRef = useRef(0);

  useEffect(() => {
    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!s) { router.replace('/login'); return; }
      setSession(s);
      const { data: p } = await supabase.from('profiles').select('*').eq('id', s.user.id).single();
      setProfile(p);
      await refreshAll();
      if (p && p.role === 'admin') {
        try {
          const res = await fetch('/api/team-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` },
          });
          const body = await res.json();
          if (res.ok) {
            const map = {};
            body.statuses.forEach(st => { map[st.id] = st.last_sign_in_at; });
            setLastSeen(map);
          }
        } catch (e) { console.error('last-seen fetch failed', e); }
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!profile) return;
    const ECHO_WINDOW_MS = 2500;
    function isEcho() { return Date.now() - lastLocalActionRef.current < ECHO_WINDOW_MS; }

    const channel = supabase
      .channel('orders-live-' + profile.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        const o = payload.new;
        const relevant =
          profile.role === 'admin' ||
          (profile.role === 'staff' && (o.staff_id === profile.id || !o.staff_id)) ||
          (profile.role === 'dispatch' && o.dispatch_id === profile.id);
        if (relevant && !isEcho()) {
          const msg = profile.role === 'staff'
            ? `🔔 You have an order to confirm — ${o.customer}${o.state ? ' · ' + o.state : ''}`
            : `🔔 New order — ${o.customer}${o.state ? ' · ' + o.state : ''}`;
          showOrderAlert(msg);
          playNotificationSound();
          if (profile.role !== 'admin') {
            sendPushNotification(session, { userIds: [profile.id], title: 'New order', body: `${o.customer}${o.state ? ' · ' + o.state : ''}`, url: '/dashboard' });
          }
        }
        refreshAll();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        const o = payload.new;
        const before = payload.old;
        const echo = isEcho();

        // Assignment changes — always relevant to the person newly assigned
        if (profile.role === 'dispatch' && o.dispatch_id === profile.id && before.dispatch_id !== profile.id && !echo) {
          showOrderAlert(`🔔 New delivery assigned — ${o.customer}${o.state ? ' · ' + o.state : ''}`);
          playNotificationSound();
          sendPushNotification(session, { userIds: [profile.id], title: 'New delivery assigned', body: o.customer, url: '/dashboard' });
        }
        if (profile.role === 'staff' && o.staff_id === profile.id && before.staff_id !== profile.id && !echo) {
          showOrderAlert(`🔔 Order assigned to you — ${o.customer}`);
          playNotificationSound();
          sendPushNotification(session, { userIds: [profile.id], title: 'Order assigned to you', body: o.customer, url: '/dashboard' });
        }

        // Status changes — curated per role so people aren't notified about their own actions
        const statusChanged = o.status !== before.status;
        if (statusChanged && !echo) {
          const orderNumber = o.id.slice(0, 8);
          if (profile.role === 'staff' && o.staff_id === profile.id) {
            const msg = `${o.customer} · #${orderNumber} — ${o.status}`;
            showOrderAlert(`🔔 ${msg}`);
            playNotificationSound();
            sendPushNotification(session, { userIds: [profile.id], title: 'Order status changed', body: msg, url: '/dashboard' });
          }
          if (profile.role === 'dispatch' && o.dispatch_id === profile.id && o.status === 'Confirmed') {
            const msg = `${o.customer} · #${orderNumber} is now Confirmed`;
            showOrderAlert(`🔔 ${msg}`);
            playNotificationSound();
            sendPushNotification(session, { userIds: [profile.id], title: 'Order confirmed', body: msg, url: '/dashboard' });
          }
        }
        refreshAll();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, session]);

  async function refreshAll() {
    lastLocalActionRef.current = Date.now();
    const [{ data: prod }, { data: ord }, { data: profs }, { data: stock }, { data: settingsRows }, { data: companies }, { data: pkgs }, { data: events }, { data: upsellRows }] = await Promise.all([
      supabase.from('products').select('*').order('created_at'),
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*'),
      supabase.from('agent_stock').select('*'),
      supabase.from('app_settings').select('*'),
      supabase.from('dispatch_companies').select('*').eq('active', true),
      supabase.from('product_packages').select('*'),
      supabase.from('order_events').select('*').eq('event_type', 'remark').order('created_at', { ascending: false }).limit(500),
      supabase.from('upsells').select('*'),
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
    const upsellMap = {};
    (upsellRows || []).forEach(u => {
      if (!upsellMap[u.original_order_id]) upsellMap[u.original_order_id] = [];
      upsellMap[u.original_order_id].push(u);
    });
    setUpsellsByOrder(upsellMap);
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
    { key: 'commission', label: 'Commission' },
    { key: 'upsellrules', label: 'Upsell Rules' },
    { key: 'upsells', label: 'Upsells' },
    { key: 'corrections', label: 'Corrections' },
    { key: 'suspicious', label: 'Suspicious Activity' },
    { key: 'settings', label: 'Settings' },
  ] : profile.role === 'staff' ? [
    { key: 'dashboard', label: 'My orders', count: myOrders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled').length },
    ...(profile.active ? [{ key: 'unassigned', label: 'Unassigned pool', count: orders.filter(o => !o.staff_id).length }] : []),
    { key: 'commission', label: 'My Commission' },
  ] : profile.role === 'dispatch' ? [
    { key: 'dashboard', label: 'My deliveries', count: myOrders.filter(o => o.status === 'Dispatched').length },
    { key: 'mystock', label: 'My stock' },
  ] : isInventoryManager ? [
    { key: 'dashboard', label: 'Inventory' },
    { key: 'agentstock', label: 'Agent stock' },
  ] : [
    { key: 'dashboard', label: 'Submit orders' },
  ];

  const finalNavItems = (profile.allowed_sections && profile.allowed_sections.length > 0)
    ? navItems.filter(n => !APP_SECTIONS.some(s => s.key === n.key) || profile.allowed_sections.includes(n.key))
    : navItems;

  return (
    <div className="app">
      <div className={'mobile-backdrop' + (mobileMenuOpen ? ' mobile-open' : '')} onClick={() => setMobileMenuOpen(false)} />
      <div className={'sidebar' + (mobileMenuOpen ? ' mobile-open' : '')}>
        <div className="brand">
          <p className="brand-name">Trailblazer</p>
          <div className="brand-role">{profile.full_name} · {roleLabel}</div>
        </div>
        <div className="nav">
          {finalNavItems.map(n => (
            <div key={n.key} className={'nav-item' + (page === n.key ? ' active' : '')} onClick={() => { setPage(n.key); setMobileMenuOpen(false); }}>
              <span>{n.label}</span>
              {n.count > 0 && <span className="nav-count">{n.count}</span>}
            </div>
          ))}
        </div>
        <div className="sidebar-foot">
          <NotificationsBell profile={profile} isAdmin={isAdmin} />
          <button
            className="switch-out"
            onClick={async () => {
              setNotifMsg('Enabling…');
              const res = await enablePushNotifications(session, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
              setNotifMsg(res.ok ? '✓ Notifications on' : res.error);
            }}
          >
            🔔 Enable push notifications
          </button>
          {notifMsg && <p style={{ fontSize: '11px', color: '#8A93A0', margin: '4px 0 0' }}>{notifMsg}</p>}
          <button className="switch-out" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <div className="main">
        <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)}>☰</button>
        {isAdmin && page === 'dashboard' && <AdminOverview orders={orders} products={products} profiles={profiles} />}
        {isAdmin && page === 'orders' && <OrdersPage orders={orders} products={products} profiles={profiles} isAdmin profile={profile} settings={settings} dispatchCompanies={dispatchCompanies} packages={packages} latestRemarks={latestRemarks} upsellsByOrder={upsellsByOrder} lastSeen={lastSeen} session={session} refresh={refreshAll} />}
        {isAdmin && page === 'products' && <ProductsPage products={products} orders={orders} packages={packages} profiles={profiles} refresh={refreshAll} />}
        {isAdmin && page === 'inventory' && <InventoryPage products={products} orders={orders} profiles={profiles} agentStock={agentStock} refresh={refreshAll} />}
        {isAdmin && page === 'agentstock' && <AgentStockPage profiles={profiles} products={products} agentStock={agentStock} refresh={refreshAll} />}
        {isAdmin && page === 'team' && <TeamPage profiles={profiles} orders={orders} products={products} session={session} lastSeen={lastSeen} refresh={refreshAll} />}
        {isAdmin && page === 'reports' && <ReportsPage orders={orders} profiles={profiles} products={products} session={session} />}
        {isAdmin && page === 'settings' && <SettingsPage settings={settings} profiles={profiles} session={session} profile={profile} refresh={refreshAll} />}
        {isAdmin && page === 'commission' && <AdminCommissionPage profiles={profiles} orders={orders} products={products} session={session} />}
        {isAdmin && page === 'upsellrules' && <UpsellRulesPage products={products} packages={packages} profiles={profiles} />}
        {isAdmin && page === 'corrections' && <CorrectionsPage profile={profile} session={session} refresh={refreshAll} />}
        {isAdmin && page === 'upsells' && <UpsellsPage products={products} packages={packages} profiles={profiles} />}
        {isAdmin && page === 'suspicious' && <SuspiciousActivityPage profiles={profiles} orders={orders} />}

        {profile.role === 'staff' && page === 'dashboard' && <OrdersPage orders={myOrders} products={products} profiles={profiles} title="My orders" myId={profile.id} myRole="staff" profile={profile} settings={settings} dispatchCompanies={dispatchCompanies} packages={packages} latestRemarks={latestRemarks} upsellsByOrder={upsellsByOrder} session={session} refresh={refreshAll} />}
        {profile.role === 'staff' && page === 'unassigned' && <UnassignedPage orders={orders.filter(o => !o.staff_id)} products={products} myId={profile.id} profile={profile} refresh={refreshAll} />}
        {profile.role === 'staff' && page === 'commission' && <CommissionPage profile={profile} orders={orders} products={products} session={session} />}

        {profile.role === 'dispatch' && page === 'dashboard' && <DispatchPage orders={myOrders} products={products} packages={packages} latestRemarks={latestRemarks} upsellsByOrder={upsellsByOrder} profile={profile} refresh={refreshAll} />}
        {profile.role === 'dispatch' && page === 'mystock' && <MyStockPage profile={profile} agentStock={agentStock} products={products} />}

        {isSubmitter && page === 'dashboard' && <SubmitterView profile={profile} products={products} orders={orders} refresh={refreshAll} />}

        {isInventoryManager && page === 'dashboard' && <InventoryPage products={products} orders={orders} profiles={profiles} agentStock={agentStock} refresh={refreshAll} />}
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

function OrderModal({ products, packages, profiles, order, isAdmin, onRequestCorrection, onSave, onClose }) {
  const [productId, setProductId] = useState(order ? order.product_id : (products[0] ? products[0].id : ''));
  const [customer, setCustomer] = useState(order ? order.customer : '');
  const [phone, setPhone] = useState(order ? order.phone : '');
  const [phone2, setPhone2] = useState(order ? order.phone2 || '' : '');
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
  const [stockError, setStockError] = useState('');
  const productPackages = (packages || []).filter(p => p.product_id === productId);
  const selectedPackage = productPackages.find(p => p.id === packageId);
  const giftProduct = selectedPackage ? products.find(p => p.id === selectedPackage.gift_product_id) : null;
  const dispatchInState = (profiles || []).filter(p => p.role === 'dispatch' && p.active && state && p.state === state);
  const otherDispatch = (profiles || []).filter(p => p.role === 'dispatch' && p.active && (!state || p.state !== state));
  const isLocked = !!order && order.status !== 'New' && !isAdmin;

  function onPackageChange(id) {
    setPackageId(id);
    const pkg = productPackages.find(p => p.id === id);
    setGiftQuantity(pkg && pkg.gift_product_id ? pkg.gift_quantity : 0);
    if (pkg && pkg.price != null) setUnitPrice(pkg.price);
  }

  function save() {
    if (!customer.trim() || !productId) return;
    if (!order) {
      const product = products.find(p => p.id === productId);
      if (!product || product.stock_quantity <= 0) {
        setStockError('This product is out of stock — add inventory before creating this order.');
        return;
      }
    }
    onSave({
      product_id: productId, customer: customer.trim(), phone: phone.trim(), phone2: phone2.trim() || null, address: address.trim(), notes: notes.trim(),
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
        {isLocked && (
          <div className="banner" style={{ marginTop: 0 }}>
            This order is confirmed — product, package, quantity, and price are locked to protect against
            fraud. {onRequestCorrection && <button className="link-btn" onClick={() => onRequestCorrection(order)}>Request a correction</button>} instead if something genuinely needs to change.
          </div>
        )}
        <label>Product</label>
        <select value={productId} onChange={e => { setProductId(e.target.value); setPackageId(''); setGiftQuantity(0); }} disabled={isLocked}>
          {products.map(p => <option key={p.id} value={p.id} disabled={!p.stock_quantity || p.stock_quantity <= 0}>{p.name} ({p.stock_quantity ?? 0} in stock){(!p.stock_quantity || p.stock_quantity <= 0) ? ' — OUT OF STOCK' : ''}</option>)}
        </select>
        {productPackages.length > 0 && (
          <>
            <label>Package</label>
            <select value={packageId} onChange={e => onPackageChange(e.target.value)} disabled={isLocked}>
              <option value="">— No package (just the product) —</option>
              {productPackages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        )}
        <label>Customer name</label>
        <input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Full name" />
        <div className="row2">
          <div><label>Phone</label><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="080..." /></div>
          <div><label>Alternate phone (optional)</label><input value={phone2} onChange={e => setPhone2(e.target.value)} placeholder="080..." /></div>
        </div>
        <div className="row2">
          <div><label>Quantity</label><input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={isLocked} /></div>
          <div><label>Unit price (₦)</label><input type="number" min="0" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="0" disabled={isLocked} /></div>
        </div>
        {isAdmin && (
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
        )}
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
        {stockError && <p style={{ fontSize: '12px', color: '#B0483F', marginTop: '10px' }}>{stockError}</p>}
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

function OrdersPage({ orders, products, profiles, isAdmin, title, myId, myRole, profile, settings, dispatchCompanies, packages, latestRemarks, upsellsByOrder, lastSeen, session, refresh }) {
  const [activeProduct, setActiveProduct] = useState('all');
  const [activeState, setActiveState] = useState('all');
  const [statusTab, setStatusTab] = useState('all');
  const [submittedOnly, setSubmittedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [historyOrder, setHistoryOrder] = useState(null);
  const [customerView, setCustomerView] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [forwarding, setForwarding] = useState(null);
  const [statusChanging, setStatusChanging] = useState(null);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [showExportPicker, setShowExportPicker] = useState(false);
  const [requestingCorrection, setRequestingCorrection] = useState(null);
  const [addingUpsellTo, setAddingUpsellTo] = useState(null);
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState(null);
  const [viewingPerson, setViewingPerson] = useState(null);
  const [actionsOpenFor, setActionsOpenFor] = useState(null);
  const [todayOnly, setTodayOnly] = useState(false);

  const byProduct = activeProduct === 'all' ? orders : orders.filter(o => o.product_id === activeProduct);
  const byState = activeState === 'all' ? byProduct : byProduct.filter(o => o.state === activeState);
  const byStatus = statusTab === 'all' ? byState : byState.filter(o => o.status === statusTab);
  const bySubmitted = submittedOnly ? byStatus.filter(o => o.created_by) : byStatus;
  const todayStr = new Date().toDateString();
  const isToday = o => new Date(o.created_at).toDateString() === todayStr || (o.reschedule_date && new Date(o.reschedule_date).toDateString() === todayStr);
  const byToday = todayOnly ? bySubmitted.filter(isToday) : bySubmitted;
  const filtered = search.trim()
    ? byToday.filter(o => {
        const q = search.trim().toLowerCase();
        return o.id.toLowerCase().includes(q) || (o.customer || '').toLowerCase().includes(q) || (o.phone || '').toLowerCase().includes(q);
      })
    : bySubmitted;
  const usedStates = [...new Set(orders.map(o => o.state).filter(Boolean))].sort();
  const staffSubmittedCount = orders.filter(o => o.created_by).length;
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  const personName = id => (profiles.find(s => s.id === id) || {}).full_name || '—';
  const pkgName = id => (packages || []).find(p => p.id === id)?.name || null;
  const giftName = pkgId => {
    const pkg = (packages || []).find(p => p.id === pkgId);
    if (!pkg || !pkg.gift_product_id) return null;
    return products.find(p => p.id === pkg.gift_product_id)?.name || null;
  };
  function timeAgo(iso) {
    if (!iso) return 'Never';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function exportCSV() {
    const useDateRange = exportFrom || exportTo;
    const source = useDateRange
      ? orders.filter(o => {
          const created = new Date(o.created_at);
          if (exportFrom && created < new Date(exportFrom)) return false;
          if (exportTo && created > new Date(exportTo + 'T23:59:59')) return false;
          return true;
        })
      : filtered;
    const headers = ['Order ID', 'Product', 'Customer', 'Phone', 'Alt Phone', 'State', 'Address', 'Quantity', 'Unit Price', 'Delivery Fee', 'Payment Status', 'Status', 'Priority', 'Preferred Time', 'Assigned Staff', 'Assigned Dispatch', 'Submitted By', 'Created At', 'Last Status Update', 'Delivered At'];
    const rows = source.map(o => [
      o.id, prodName(o.product_id), o.customer, o.phone, o.phone2 || '', o.state || '', (o.address || '').replace(/\n/g, ' '),
      o.quantity || 1, o.unit_price ?? '', o.delivery_fee ?? 0, o.payment_status || '', o.status,
      o.priority || '', o.preferred_time || '', personName(o.staff_id), personName(o.dispatch_id),
      o.created_by ? personName(o.created_by) : '', o.created_at, o.status_updated_at || '', o.delivered_at || '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = useDateRange
      ? `${exportFrom || 'start'}_to_${exportTo || 'now'}`
      : new Date().toISOString().slice(0, 10);
    const stateLabel = activeState === 'all' ? 'all-states' : activeState.replace(/\s+/g, '-');
    a.href = url;
    a.download = `orders-backup-${stateLabel}-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportPicker(false);
  }

  async function createOrder(fields) {
    if (myRole === 'staff' && !fields.staff_id) {
      fields = { ...fields, staff_id: myId };
    }
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
      const notifyIds = profiles
        .filter(p => p.role === 'admin' || (p.role === 'staff' && p.active && p.id !== profile?.id))
        .map(p => p.id);
      sendPushNotification(session, {
        userIds: notifyIds, title: 'New order', body: `${data.customer}${data.state ? ' · ' + data.state : ''}`,
        url: '/dashboard',
      });
    }
    refresh();
  }

  async function adjustStockForOrder(o, direction) {
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
    if (patch.status && current && patch.status !== current.status) {
      patch.status_updated_at = new Date().toISOString();
    }
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
      const newlyAssigned = [patch.staff_id, patch.dispatch_id].filter(pid => pid && pid !== current?.staff_id && pid !== current?.dispatch_id);
      if (newlyAssigned.length > 0) {
        sendPushNotification(session, {
          userIds: newlyAssigned, title: 'Order assigned to you', body: current ? current.customer : 'An order was just assigned to you.',
          url: '/dashboard',
        });
      }
    }
    if (patch.status === 'Delivered' || patch.payment_status === 'Paid') {
      await supabase.rpc('sync_upsells_for_order', { p_order_id: id });
      await recordFreeCommissionForOrder({ id });
    }
    if (patch.status === 'Cancelled') {
      await supabase.rpc('cancel_upsells_for_order', { p_order_id: id });
    }
    refresh();
  }

  async function markPaid(o) {
    await supabase.from('orders').update({ payment_status: 'Paid' }).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: 'Payment confirmed — marked as Paid.' });
    await recordCommissionForOrder(o);
    await recordFreeCommissionForOrder(o);
    await supabase.rpc('sync_upsells_for_order', { p_order_id: o.id });
    refresh();
  }

  async function resetPaid(o) {
    await supabase.from('orders').update({ payment_status: 'Unpaid' }).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: 'Admin corrected payment status back to Unpaid — no payment was actually received.' });
    await reverseCommissionForOrder(o.id);
    refresh();
  }

  async function copyTrackingLink(orderId) {
    await copyToClipboard(`${window.location.origin}/track/${orderId}`, 'Tracking link copied');
    setActionsOpenFor(null);
  }

  async function copyOrderInfo(o) {
    await copyToClipboard(buildOrderSummary(o, products, packages, upsellsByOrder && upsellsByOrder[o.id]), 'Order info copied');
    setActionsOpenFor(null);
  }

  async function withdrawUpsell(u) {
    const { error } = await supabase.rpc('withdraw_upsell', { p_upsell_id: u.id });
    if (error) { alert(error.message); return; }
    refresh();
  }

  async function deleteOrder(o) {
    await supabase.from('orders').delete().eq('id', o.id);
    setConfirmDeleteOrder(null);
    refresh();
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1 className="page-title">{title || 'All orders'}</h1>
          <p className="page-sub">{filtered.length} order{filtered.length !== 1 ? 's' : ''}{activeProduct !== 'all' ? ' · ' + prodName(activeProduct) : ''}{activeState !== 'all' ? ' · ' + activeState : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {isAdmin && usedStates.length > 0 && (
            <select className="status-sel" value={activeState} onChange={e => setActiveState(e.target.value)}>
              <option value="all">All states</option>
              {usedStates.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {isAdmin && staffSubmittedCount > 0 && (
            <button className={'btn' + (submittedOnly ? ' primary' : '')} onClick={() => setSubmittedOnly(!submittedOnly)}>
              Staff submissions ({staffSubmittedCount})
            </button>
          )}
          {isAdmin && <button className="btn" onClick={() => setShowExportPicker(!showExportPicker)}>⬇ Export backup (CSV)</button>}
          {(isAdmin || (myRole === 'staff' && profile?.can_create_orders !== false)) && <button className="btn primary" onClick={() => setShowNew(true)}>+ New order</button>}
        </div>
      </div>

      {showExportPicker && (
        <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '14px', marginBottom: '16px', maxWidth: '460px' }}>
          <p style={{ fontSize: '12.5px', color: '#4B5566', marginTop: 0, marginBottom: '10px' }}>
            Leave both blank to export exactly what's currently shown on screen. Set a date range to export
            <strong> every order</strong> from that period, regardless of the filters above.
          </p>
          <div className="row2" style={{ marginBottom: '10px' }}>
            <div><label className="field-label" style={{ marginTop: 0 }}>From</label><input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
            <div><label className="field-label" style={{ marginTop: 0 }}>To</label><input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid #DEDAD0', borderRadius: '4px' }} /></div>
          </div>
          <button className="btn primary" onClick={exportCSV} style={{ width: '100%' }}>Download CSV</button>
        </div>
      )}

      <div style={{ marginBottom: '14px' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Quick find: order ID, customer name, or phone…"
          style={{ width: '100%', maxWidth: '420px', padding: '9px 12px', border: '1px solid #DEDAD0', borderRadius: '6px', fontSize: '13.5px' }}
        />
      </div>

      <div className="product-tabs">
        <span className={'ptab' + (statusTab === 'all' ? ' active' : '')} onClick={() => setStatusTab('all')}>All statuses</span>
        {STATUSES.map(s => {
          const count = byState.filter(o => o.status === s).length;
          const showCount = s !== 'Delivered' && s !== 'Cancelled';
          return <span key={s} className={'ptab' + (statusTab === s ? ' active' : '')} onClick={() => setStatusTab(s)}>{s}{showCount ? ` (${count})` : ''}</span>;
        })}
        <span className={'ptab' + (todayOnly ? ' active' : '')} onClick={() => setTodayOnly(!todayOnly)}>📅 Today only</span>
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
          <thead><tr><th>Order</th><th>Product</th><th>Customer</th><th>Payment</th><th>Assigned to</th><th>Status</th><th>Scheduled</th><th>Created</th><th>Last updated</th><th></th></tr></thead>
          <tbody>
            {filtered.map(o => (
              <tr key={o.id} style={{ backgroundColor: statusRowColor(o.status) }}>
                <td className="oid">{o.id.slice(0, 8)}</td>
                <td>
                  {(() => {
                    const orderUpsells = upsellsByOrder && upsellsByOrder[o.id];
                    const current = getCurrentPackage(o, orderUpsells);
                    const pending = (orderUpsells || []).find(u => u.commission_status === 'Pending');
                    return (
                      <>
                        {prodName(current.productId)} <span style={{ color: '#8A93A0', fontSize: '11px' }}>×{current.quantity}</span>
                        <div style={{ fontSize: '11px', color: '#8A93A0' }}>₦{current.unitPrice.toLocaleString()} each</div>
                        {pkgName(current.packageId) && <div style={{ fontSize: '11px', color: '#8A93A0' }}>Package: {pkgName(current.packageId)}</div>}
                        {giftName(current.packageId) && <div style={{ fontSize: '11px', color: '#8A93A0' }}>🎁 {giftName(current.packageId)} × {o.gift_quantity}</div>}
                        {current.changed && (
                          <div style={{ fontSize: '10.5px', color: '#8A93A0', marginTop: '3px' }}>
                            ⬆ Changed from {prodName(current.previousProductId)}{pkgName(current.previousPackageId) ? ` · ${pkgName(current.previousPackageId)}` : ''}
                            {pending && (isAdmin || pending.staff_id === myId) && (
                              <> · <span className="link-btn" style={{ fontSize: '10px' }} onClick={() => withdrawUpsell(pending)}>Withdraw</span></>
                            )}
                          </div>
                        )}
                        {o.created_by && (
                          <div style={{ fontSize: '10.5px', color: '#2E6E62', marginTop: '3px' }}>
                            ✎ Submitted by {personName(o.created_by)}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </td>
                <td>
                  <span className="link-btn" onClick={() => setCustomerView(o)}>{o.customer}</span>
                  <div style={{ fontSize: '11px', color: '#8A93A0' }}>{o.phone}{o.state ? ` · ${o.state}` : ''}</div>
                  {o.phone2 && <div style={{ fontSize: '11px', color: '#8A93A0' }}>Alt: {o.phone2}</div>}
                </td>
                <td style={{ fontSize: '12px' }}>
                  <span className={'pill ' + (o.payment_status === 'Paid' ? 'Delivered' : o.payment_status === 'Partial' ? 'Preparing' : 'Cancelled')}>{o.payment_status || 'Unpaid'}</span>
                  {isAdmin && <div style={{ color: '#8A93A0', marginTop: '3px' }}>₦{orderTotal(o, upsellsByOrder && upsellsByOrder[o.id]).toLocaleString()}</div>}
                  {isAdmin && o.payment_status !== 'Paid' && <div><button className="link-btn" onClick={() => markPaid(o)} style={{ fontSize: '11px' }}>Mark Paid</button></div>}
                  {isAdmin && o.payment_status === 'Paid' && <div><button className="link-btn" onClick={() => resetPaid(o)} style={{ fontSize: '11px' }}>Reset to Unpaid</button></div>}
                </td>
                <td style={{ fontSize: '12px' }}>
                  {o.staff_id ? <span className="link-btn" onClick={() => setViewingPerson(profiles.find(p => p.id === o.staff_id))}>{personName(o.staff_id)}</span> : <span style={{ color: '#B0483F' }}>Unassigned staff</span>}
                  {o.dispatch_id ? (
                    <div style={{ color: '#8A93A0' }}>
                      <span className="link-btn" onClick={() => setViewingPerson(profiles.find(p => p.id === o.dispatch_id))}>{personName(o.dispatch_id)}</span>
                      {isAdmin && Number(o.delivery_fee || 0) > 0 && <div style={{ fontSize: '10.5px' }}>Charged: ₦{Number(o.delivery_fee).toLocaleString()}</div>}
                    </div>
                  ) : null}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isAdmin || (myRole === 'staff' && (o.staff_id === myId || !o.staff_id)) ? (
                      <select className="status-sel" value={o.status} onChange={e => setStatusChanging({ order: o, newStatus: e.target.value })}>
                        {STATUSES.filter(s => (s !== 'New' || o.status === 'New') && (isAdmin || !profile?.allowed_statuses || profile.allowed_statuses.length === 0 || profile.allowed_statuses.includes(s) || s === o.status)).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <span className={'pill ' + o.status}>{o.status}</span>}
                    {o.priority === 'High' && <span className="pill Cancelled">High</span>}
                  </div>
                  {latestRemarks && latestRemarks[o.id] && (
                    <div style={{ fontSize: '10.5px', color: '#4B5566', marginTop: '4px', maxWidth: '200px', fontStyle: 'italic' }}>
                      💬 {latestRemarks[o.id].note} <span style={{ color: '#8A93A0' }}>— {latestRemarks[o.id].actor_name || 'System'}</span>
                    </div>
                  )}
                </td>
                <td style={{ fontSize: '11.5px', color: '#8A93A0', whiteSpace: 'nowrap' }}>
                  {o.reschedule_date && <div>📅 {o.reschedule_date}</div>}
                  {o.preferred_time && <div>⏰ {o.preferred_time}</div>}
                  {!o.reschedule_date && !o.preferred_time && '—'}
                </td>
                <td style={{ fontSize: '11.5px', color: '#8A93A0', whiteSpace: 'nowrap' }}>
                  {new Date(o.created_at).toLocaleDateString()}<br />{new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td style={{ fontSize: '11.5px', color: '#8A93A0', whiteSpace: 'nowrap' }}>
                  {o.status_updated_at ? (
                    <>{new Date(o.status_updated_at).toLocaleDateString()}<br />{new Date(o.status_updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
                  ) : '—'}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', position: 'relative' }}>
                  {(isAdmin || (myRole === 'staff' && (o.staff_id === myId || !o.staff_id))) && o.status === 'New' && <><button className="link-btn" onClick={() => setConfirming(o)}>Confirm</button>{' · '}</>}
                  {(isAdmin || (myRole === 'staff' && o.staff_id === myId)) && o.status === 'Cancelled' && <><button className="link-btn" onClick={() => setConfirming(o)}>Reconfirm</button>{' · '}</>}
                  {(isAdmin || (myRole === 'staff' && (o.staff_id === myId || !o.staff_id))) && o.confirmed_at && o.status !== 'Cancelled' && <><button className="link-btn" onClick={() => setAddingUpsellTo(o)}>Change package</button>{' · '}</>}
                  {isAdmin && <button className="link-btn" onClick={() => setAssigning(o)}>Assign / Send to dispatch</button>}
                  {' · '}
                  {(isAdmin || (myRole === 'staff' && (o.staff_id === myId || !o.staff_id))) && <><button className="link-btn" onClick={() => setEditing(o)}>Edit</button>{' · '}</>}
                  <button className="link-btn" onClick={() => setActionsOpenFor(actionsOpenFor === o.id ? null : o.id)}>More ▾</button>
                  {actionsOpenFor === o.id && (
                    <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: '4px', background: '#fff', border: '1px solid #DEDAD0', borderRadius: '6px', boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 30, textAlign: 'left', minWidth: '190px', padding: '6px' }}>
                      <div style={{ padding: '7px 10px', cursor: 'pointer', fontSize: '12.5px' }} onClick={() => { setHistoryOrder(o); setActionsOpenFor(null); }}>History</div>
                      <div style={{ padding: '7px 10px', cursor: 'pointer', fontSize: '12.5px' }} onClick={() => copyTrackingLink(o.id)}>Copy tracking link</div>
                      <div style={{ padding: '7px 10px', cursor: 'pointer', fontSize: '12.5px' }} onClick={() => copyOrderInfo(o)}>Copy full order info</div>
                      {isAdmin && o.phone && (
                        <div style={{ padding: '7px 10px', cursor: 'pointer', fontSize: '12.5px' }} onClick={() => { sendConfirmation({ phone: o.phone, customerName: o.customer, orderId: o.id, sendSms: true, sendWhatsapp: true }); setActionsOpenFor(null); }}>Send confirmation</div>
                      )}
                      {isAdmin && dispatchCompanies && dispatchCompanies.length > 0 && (
                        <div style={{ padding: '7px 10px', cursor: 'pointer', fontSize: '12.5px' }} onClick={() => { setForwarding(o); setActionsOpenFor(null); }}>Forward to external</div>
                      )}
                      {isAdmin && (
                        <div style={{ padding: '7px 10px', cursor: 'pointer', fontSize: '12.5px', color: '#B0483F', borderTop: '1px solid #F0EEE8', marginTop: '4px' }} onClick={() => { setConfirmDeleteOrder(o); setActionsOpenFor(null); }}>Delete order permanently</div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && <OrderModal products={products} packages={packages} profiles={isAdmin ? profiles : null} isAdmin={isAdmin} onClose={() => setShowNew(false)} onSave={createOrder} />}
      {editing && <OrderModal products={products} packages={packages} profiles={isAdmin ? profiles : null} isAdmin={isAdmin} order={editing} onRequestCorrection={(o) => { setEditing(null); setRequestingCorrection(o); }} onClose={() => setEditing(null)} onSave={(fields) => { updateOrder(editing.id, fields); setEditing(null); }} />}
      {requestingCorrection && <RequestCorrectionModal order={requestingCorrection} profile={profile} onClose={() => setRequestingCorrection(null)} onSubmitted={() => { setRequestingCorrection(null); refresh(); }} />}
      {addingUpsellTo && <AddUpsellModal order={addingUpsellTo} products={products} packages={packages} profile={profile} onClose={() => setAddingUpsellTo(null)} onCreated={() => { setAddingUpsellTo(null); refresh(); }} />}
      {confirmDeleteOrder && (
        <div className="overlay" onClick={() => setConfirmDeleteOrder(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Delete order permanently?</h3>
            <p style={{ fontSize: '13px', color: '#4B5566' }}>
              This permanently deletes the order for <strong>{confirmDeleteOrder.customer}</strong> ({confirmDeleteOrder.id.slice(0, 8)}) and everything tied to it —
              history, upsells, and commission records. This can't be undone.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmDeleteOrder(null)}>Cancel</button>
              <button className="btn" style={{ background: '#B0483F', color: '#fff', borderColor: '#B0483F' }} onClick={() => deleteOrder(confirmDeleteOrder)}>Yes, delete permanently</button>
            </div>
          </div>
        </div>
      )}
      {assigning && <AssignModal order={assigning} profiles={profiles} onClose={() => setAssigning(null)} onSave={(patch) => { updateOrder(assigning.id, patch, 'assigned'); setAssigning(null); }} />}
      {historyOrder && <OrderHistoryModal order={historyOrder} products={products} profile={profile} onClose={() => setHistoryOrder(null)} onLogged={refresh} />}
      {customerView && <CustomerHistoryModal phone={customerView.phone} customer={customerView.customer} orders={orders} products={products} onClose={() => setCustomerView(null)} />}
      {confirming && <ConfirmOrderModal order={confirming} profile={profile} profiles={profiles} session={session} onClose={() => setConfirming(null)} onConfirmed={() => { setConfirming(null); refresh(); }} />}
      {viewingPerson && <PersonDetailModal person={viewingPerson} orders={orders} lastSeenText={timeAgo(lastSeen && lastSeen[viewingPerson.id])} session={session} onChanged={refresh} onClose={() => setViewingPerson(null)} />}
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
          onConfirm={({ remark, fee, rescheduleDate, paidNow }) => {
            const patch = { status: statusChanging.newStatus };
            if (statusChanging.newStatus === 'Delivered') {
              patch.delivery_fee = fee;
              if (paidNow) patch.payment_status = 'Paid';
            }
            if (statusChanging.newStatus === 'Rescheduled') patch.reschedule_date = rescheduleDate || null;
            updateOrder(statusChanging.order.id, patch, null, remark);
            if (paidNow) recordCommissionForOrder(statusChanging.order);
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
  const locked = order.status === 'Delivered';

  if (!editing) {
    return (
      <div>
        <span style={{ fontSize: '13px' }}>₦{Number(order.delivery_fee || 0).toLocaleString()}</span>{' '}
        {locked ? (
          <span style={{ fontSize: '10.5px', color: '#8A93A0' }}>Locked</span>
        ) : (
          <button className="link-btn" onClick={() => setEditing(true)} style={{ fontSize: '11px' }}>Edit</button>
        )}
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

function DispatchPage({ orders, products, packages, latestRemarks, upsellsByOrder, profile, refresh }) {
  const [statusChanging, setStatusChanging] = useState(null);
  const [statusTab, setStatusTab] = useState('all');
  const [todayOnly, setTodayOnly] = useState(false);
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  const pkgName = id => (packages || []).find(p => p.id === id)?.name || null;
  const giftName = pkgId => {
    const pkg = (packages || []).find(p => p.id === pkgId);
    if (!pkg || !pkg.gift_product_id) return null;
    return products.find(p => p.id === pkg.gift_product_id)?.name || null;
  };
  const todayStr = new Date().toDateString();
  const isToday = o => new Date(o.created_at).toDateString() === todayStr || (o.reschedule_date && new Date(o.reschedule_date).toDateString() === todayStr);
  const byStatus = statusTab === 'all' ? orders : orders.filter(o => o.status === statusTab);
  const filtered = todayOnly ? byStatus.filter(isToday) : byStatus;

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

  async function applyStatusChange(o, status, { remark, fee, rescheduleDate, paidNow } = {}) {
    const patch = { status, status_updated_at: new Date().toISOString() };
    if (status === 'Delivered') {
      patch.delivered_at = new Date().toISOString();
      patch.delivery_fee = fee ?? 0;
      if (paidNow) patch.payment_status = 'Paid';
      await deductStockForDelivery(o);
    }
    if (status === 'Rescheduled') patch.reschedule_date = rescheduleDate || null;
    await supabase.from('orders').update(patch).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'status_change', from_status: o.status, to_status: status });
    if (status === 'Delivered' && paidNow) {
      await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: 'Payment collected at delivery — marked as Paid.' });
      await recordCommissionForOrder(o);
    }
    if (remark && remark.trim()) {
      await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: remark.trim() });
    }
    if (status === 'Delivered' || paidNow) {
      await supabase.rpc('sync_upsells_for_order', { p_order_id: o.id });
      await recordFreeCommissionForOrder(o);
    }
    if (status === 'Cancelled') {
      await supabase.rpc('cancel_upsells_for_order', { p_order_id: o.id });
    }
    setStatusChanging(null);
    refresh();
  }

  async function markPaid(o) {
    await supabase.from('orders').update({ payment_status: 'Paid' }).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: 'Payment confirmed by dispatch — marked as Paid.' });
    await recordCommissionForOrder(o);
    await recordFreeCommissionForOrder(o);
    await supabase.rpc('sync_upsells_for_order', { p_order_id: o.id });
    refresh();
  }

  async function setDeliveryFee(o, fee) {
    const amount = parseFloat(fee) || 0;
    await supabase.from('orders').update({ delivery_fee: amount }).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'remark', note: `Delivery fee set to ₦${amount.toLocaleString()} by dispatch.` });
    refresh();
  }

  async function copyOrderInfo(o) {
    await copyToClipboard(buildOrderSummary(o, products, packages, upsellsByOrder && upsellsByOrder[o.id]), 'Order info copied');
  }

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">My deliveries</h1><p className="page-sub">Orders assigned to you for dispatch.</p></div></div>
      <div className="stats" style={{ marginBottom: '18px' }}>
        <div className="stat"><div className="stat-num">{orders.filter(o => o.status === 'New').length}</div><div className="stat-label">New orders</div></div>
        <div className="stat"><div className="stat-num">{orders.filter(o => o.status === 'Delivered').length}</div><div className="stat-label">Delivered</div></div>
        <div className="stat"><div className="stat-num">{orders.filter(o => !['Delivered', 'Cancelled'].includes(o.status)).length}</div><div className="stat-label">In progress</div></div>
      </div>
      <div className="product-tabs">
        <span className={'ptab' + (statusTab === 'all' ? ' active' : '')} onClick={() => setStatusTab('all')}>All</span>
        {STATUSES.map(s => {
          const count = orders.filter(o => o.status === s).length;
          if (count === 0) return null;
          const showCount = s !== 'Delivered' && s !== 'Cancelled';
          return <span key={s} className={'ptab' + (statusTab === s ? ' active' : '')} onClick={() => setStatusTab(s)}>{s}{showCount ? ` (${count})` : ''}</span>;
        })}
        <span className={'ptab' + (todayOnly ? ' active' : '')} onClick={() => setTodayOnly(!todayOnly)}>📅 Today only</span>
      </div>
      {filtered.length === 0 ? <div className="empty">No deliveries here yet.</div> : (
        <>
        <div className="desktop-only">
        <table>
          <thead><tr><th>Order</th><th>Product & package</th><th>To collect</th><th>Customer & delivery</th><th>Status</th><th>Payment</th><th></th></tr></thead>
          <tbody>
            {filtered.map(o => {
              const current = getCurrentPackage(o, upsellsByOrder && upsellsByOrder[o.id]);
              const unpaidDelivered = o.status === 'Delivered' && o.payment_status !== 'Paid';
              return (
              <tr key={o.id}>
                <td className="oid">{o.id.slice(0, 8)}</td>
                <td>
                  {prodName(current.productId)} <span style={{ color: '#8A93A0', fontSize: '11px' }}>×{current.quantity}</span>
                  <div style={{ fontSize: '11px', color: '#8A93A0' }}>₦{current.unitPrice.toLocaleString()} each</div>
                  {pkgName(current.packageId) && <div style={{ fontSize: '11px', color: '#8A93A0' }}>Package: {pkgName(current.packageId)}</div>}
                  {giftName(current.packageId) && <div style={{ fontSize: '11px', color: '#8A93A0' }}>🎁 {giftName(current.packageId)} × {o.gift_quantity}</div>}
                  {o.priority === 'High' && <span className="pill Cancelled" style={{ marginTop: '4px', display: 'inline-block' }}>High priority</span>}
                  {current.changed && <div style={{ fontSize: '10.5px', color: '#8A93A0', marginTop: '3px' }}>⬆ Package changed — deliver this</div>}
                </td>
                <td style={{ fontWeight: 600 }}>
                  <div>₦{current.amount.toLocaleString()}</div>
                  <div style={{ fontWeight: 400, marginTop: '4px' }}><DeliveryFeeCell order={o} onSave={(fee) => setDeliveryFee(o, fee)} /></div>
                </td>
                <td>
                  {o.customer}<div style={{ fontSize: '11px', color: '#8A93A0' }}>{o.phone}</div>
                  <div style={{ fontSize: '11.5px', color: '#8A93A0', marginTop: '2px' }}>{o.address || '—'}</div>
                  {(o.reschedule_date || o.preferred_time) && (
                    <div style={{ fontSize: '10.5px', color: '#8A93A0', marginTop: '3px' }}>{o.reschedule_date ? `📅 ${o.reschedule_date}` : `⏰ ${o.preferred_time}`}</div>
                  )}
                  {latestRemarks && latestRemarks[o.id] && (
                    <div style={{ fontSize: '10.5px', color: '#4B5566', marginTop: '4px', maxWidth: '200px', fontStyle: 'italic' }}>💬 {latestRemarks[o.id].note}</div>
                  )}
                </td>
                <td>
                  {o.status === 'New' ? (
                    <span style={{ fontSize: '11.5px', color: '#8A93A0' }}>Awaiting confirmation</span>
                  ) : o.status === 'Delivered' || o.status === 'Cancelled' ? (
                    <span className={'pill ' + o.status} style={{ backgroundColor: statusRowColor(o.status) }}>{o.status}</span>
                  ) : (
                    <select
                      className="status-sel"
                      value={o.status}
                      style={{ backgroundColor: statusRowColor(o.status), fontWeight: 600, border: 'none' }}
                      onChange={e => setStatusChanging({ order: o, newStatus: e.target.value })}
                    >
                      {STATUSES.filter(s => s !== 'New').map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  <div style={{ marginTop: '8px' }}><button className="link-btn" onClick={() => copyOrderInfo(o)}>Copy info</button></div>
                </td>
                <td>
                  {unpaidDelivered ? (
                    <button
                      onClick={() => markPaid(o)}
                      style={{ background: '#C6862F', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Mark as Paid
                    </button>
                  ) : (
                    <span className={'pill ' + (o.payment_status === 'Paid' ? 'Delivered' : 'Cancelled')}>{o.payment_status === 'Paid' ? 'Remitted' : 'Not remitted'}</span>
                  )}
                  {o.status !== 'Delivered' && <div style={{ fontSize: '10.5px', color: '#8A93A0', marginTop: '3px' }}>Available after delivery</div>}
                </td>
              </tr>
            );})}
          </tbody>
        </table>
        </div>

        <div className="mobile-only">
          {filtered.map(o => {
            const current = getCurrentPackage(o, upsellsByOrder && upsellsByOrder[o.id]);
            const unpaidDelivered = o.status === 'Delivered' && o.payment_status !== 'Paid';
            return (
              <div key={o.id} className="mobile-card" style={{ border: unpaidDelivered ? '2px solid #B0483F' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span className="oid">{o.id.slice(0, 8)}</span>
                  {o.status === 'New' ? (
                    <span style={{ fontSize: '11.5px', color: '#8A93A0' }}>Awaiting confirmation</span>
                  ) : o.status === 'Delivered' || o.status === 'Cancelled' ? (
                    <span className={'pill ' + o.status} style={{ backgroundColor: statusRowColor(o.status) }}>{o.status}</span>
                  ) : (
                    <select
                      className="status-sel"
                      value={o.status}
                      style={{ backgroundColor: statusRowColor(o.status), fontWeight: 600, border: 'none' }}
                      onChange={e => setStatusChanging({ order: o, newStatus: e.target.value })}
                    >
                      {STATUSES.filter(s => s !== 'New').map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>{prodName(current.productId)} ×{current.quantity}</div>
                {pkgName(current.packageId) && <div style={{ fontSize: '12px', color: '#8A93A0' }}>{pkgName(current.packageId)}</div>}
                {current.changed && <div style={{ fontSize: '11px', color: '#8A93A0', marginTop: '2px' }}>⬆ Package changed — deliver this one</div>}
                <div className="mobile-card-row"><span className="mobile-card-label">Customer</span><span className="mobile-card-value">{o.customer}</span></div>
                <div className="mobile-card-row"><span className="mobile-card-label">Phone</span><span className="mobile-card-value"><a href={`tel:${o.phone}`}>{o.phone}</a></span></div>
                <div className="mobile-card-row"><span className="mobile-card-label">Address</span><span className="mobile-card-value">{o.address || '—'}</span></div>
                <div className="mobile-card-row"><span className="mobile-card-label">To collect</span><span className="mobile-card-value" style={{ fontWeight: 600 }}>₦{current.amount.toLocaleString()}</span></div>
                <div className="mobile-card-row"><span className="mobile-card-label">Delivery fee</span><span className="mobile-card-value"><DeliveryFeeCell order={o} onSave={(fee) => setDeliveryFee(o, fee)} /></span></div>
                {(o.reschedule_date || o.preferred_time) && (
                  <div className="mobile-card-row"><span className="mobile-card-label">Scheduled</span><span className="mobile-card-value">{o.reschedule_date || o.preferred_time}</span></div>
                )}
                {latestRemarks && latestRemarks[o.id] && (
                  <div style={{ fontSize: '11px', color: '#4B5566', marginTop: '6px', fontStyle: 'italic' }}>💬 {latestRemarks[o.id].note}</div>
                )}
                <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                  {unpaidDelivered && (
                    <button
                      onClick={() => markPaid(o)}
                      style={{ background: '#C6862F', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Mark as Paid
                    </button>
                  )}
                  <button className="btn" onClick={() => copyOrderInfo(o)}>Copy info</button>
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}
      {statusChanging && (
        <StatusRemarkModal
          order={statusChanging.order} newStatus={statusChanging.newStatus} hidePaidCheckbox
          onClose={() => setStatusChanging(null)}
          onConfirm={({ remark, fee, rescheduleDate }) => applyStatusChange(statusChanging.order, statusChanging.newStatus, { remark, fee, rescheduleDate })}
        />
      )}
    </div>
  );
}

function ProductsPage({ products, orders, packages, profiles, refresh }) {
  const [name, setName] = useState('');
  const [managingPackages, setManagingPackages] = useState(null);
  const [managingCommission, setManagingCommission] = useState(null);
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
                <button className="link-btn" onClick={() => setManagingCommission(p)}>Standard & upsell commission</button>
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
      {managingCommission && <CommissionRuleModal product={managingCommission} profiles={profiles} onClose={() => setManagingCommission(null)} />}
    </div>
  );
}

function TeamPage({ profiles, orders, products, session, lastSeen, refresh }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [state, setState] = useState('');
  const [allowedProducts, setAllowedProducts] = useState([]);
  const [allowedSections, setAllowedSections] = useState([]);
  const [status, setStatus] = useState('');
  const [editingAccess, setEditingAccess] = useState(null);
  const [viewingPerson, setViewingPerson] = useState(null);
  const staffList = profiles.filter(p => p.role !== 'admin');
  const isSubmitterRole = ['manager', 'logistics', 'marketer'].includes(role);
  const [roleTab, setRoleTab] = useState('all');
  const ROLE_TABS = [
    { key: 'all', label: 'All' },
    { key: 'staff', label: 'Staff' },
    { key: 'dispatch', label: 'Dispatch' },
    { key: 'manager', label: 'Manager' },
    { key: 'logistics', label: 'Logistics' },
    { key: 'marketer', label: 'Marketer' },
    { key: 'inventory', label: 'Inventory' },
  ];
  const visibleStaffList = roleTab === 'all' ? staffList : staffList.filter(s => s.role === roleTab);

  function toggleIn(id, list, setList) {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  }
  function timeAgo(iso) {
    if (!iso) return 'Never';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
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
        allowed_sections: allowedSections.length > 0 ? allowedSections : null,
        username: username.trim() || null,
      }),
    });
    const body = await res.json();
    if (!res.ok) { setStatus(body.error || 'Something went wrong.'); return; }
    setStatus(`Login created for ${name.trim()}.`);
    setName(''); setUsername(''); setEmail(''); setPassword(''); setState(''); setAllowedProducts([]); setAllowedSections([]);
    refresh();
  }

  async function toggleActive(s) {
    await supabase.from('profiles').update({ active: !s.active }).eq('id', s.id);
    refresh();
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  async function removeUser(id) {
    await fetch('/api/delete-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ userId: id }),
    });
    setConfirmDeleteId(null);
    refresh();
  }

  async function saveAccess(id, productList, sectionList, canCreateOrders, allowedStatuses) {
    await supabase.from('profiles').update({
      allowed_products: productList,
      allowed_sections: sectionList.length > 0 ? sectionList : null,
      can_create_orders: canCreateOrders,
      allowed_statuses: allowedStatuses && allowedStatuses.length > 0 ? allowedStatuses : null,
    }).eq('id', id);
    setEditingAccess(null);
    refresh();
  }

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Team</h1><p className="page-sub">Create a real login for each person — staff, dispatch, managers, or inventory. They can sign in with either their email or a username.</p></div></div>

      <div className="product-tabs">
        {ROLE_TABS.map(t => {
          const count = t.key === 'all' ? staffList.length : staffList.filter(s => s.role === t.key).length;
          if (t.key !== 'all' && count === 0) return null;
          return <span key={t.key} className={'ptab' + (roleTab === t.key ? ' active' : '')} onClick={() => setRoleTab(t.key)}>{t.label} ({count})</span>;
        })}
      </div>

      <div className="list-manage" style={{ marginBottom: '18px' }}>
        {visibleStaffList.map(s => {
          const load = orders.filter(o => (s.role === 'staff' ? o.staff_id : s.role === 'dispatch' ? o.dispatch_id : o.created_by) === s.id).length;
          return (
            <div key={s.id} className="list-manage-row">
              <span>
                <span className="link-btn" onClick={() => setViewingPerson(s)}>{s.full_name}</span>
                {' '}<span style={{ color: '#8A93A0', fontSize: '11.5px' }}>({s.role}{s.state ? ` · ${s.state}` : ''}{s.username ? ` · @${s.username}` : ''}) · {load} orders · joined {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'} · last seen {timeAgo(lastSeen && lastSeen[s.id])}</span>
                {!s.active && <span className="pill Cancelled" style={{ marginLeft: '8px' }}>Not receiving orders</span>}
              </span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {confirmDeleteId === s.id ? (
                  <>
                    <span style={{ fontSize: '11.5px', color: '#B0483F' }}>Delete permanently?</span>
                    <button className="btn" style={{ background: '#B0483F', color: '#fff', borderColor: '#B0483F' }} onClick={() => removeUser(s.id)}>Yes, delete</button>
                    <button className="btn" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="link-btn" onClick={() => setEditingAccess(s)}>Edit access</button>
                    <button className="btn" onClick={() => toggleActive(s)}>{s.active ? 'Receiving orders: On' : 'Receiving orders: Off'}</button>
                    <button className="btn" style={{ color: '#B0483F' }} onClick={() => setConfirmDeleteId(s.id)}>Delete</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {visibleStaffList.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No one in this category yet.</div>}
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
                  <input type="checkbox" checked={allowedProducts.includes(p.id)} onChange={() => toggleIn(p.id, allowedProducts, setAllowedProducts)} />
                  {p.name}
                </label>
              ))}
            </div>
            <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '-8px', marginBottom: '12px' }}>Leave all unchecked to give access to every product.</p>
          </>
        )}
        <label className="field-label">Extra section access (optional)</label>
        <div style={{ border: '1px solid #DEDAD0', borderRadius: '4px', padding: '8px', maxHeight: '160px', overflowY: 'auto', marginBottom: '6px' }}>
          {APP_SECTIONS.map(sec => (
            <label key={sec.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '4px 2px' }}>
              <input type="checkbox" checked={allowedSections.includes(sec.key)} onChange={() => toggleIn(sec.key, allowedSections, setAllowedSections)} />
              {sec.label}
            </label>
          ))}
        </div>
        <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '-2px', marginBottom: '12px' }}>Leave unchecked for their role's normal default access. Check boxes here to give this person extra sections beyond their role (e.g. letting a staff member also see Reports).</p>
        <button className="btn primary" onClick={createLogin} style={{ width: '100%' }}>Create login</button>
        {status && <p style={{ fontSize: '12px', color: '#4B5566', marginTop: '10px' }}>{status}</p>}
      </div>

      {editingAccess && (
        <div className="overlay" onClick={() => setEditingAccess(null)}>
          <EditAccessModal person={editingAccess} products={products} onClose={() => setEditingAccess(null)} onSave={saveAccess} />
        </div>
      )}
      {viewingPerson && <PersonDetailModal person={viewingPerson} orders={orders} lastSeenText={timeAgo(lastSeen && lastSeen[viewingPerson.id])} session={session} onChanged={refresh} onClose={() => setViewingPerson(null)} />}
    </div>
  );
}

function EditAccessModal({ person, products, onClose, onSave }) {
  const [productList, setProductList] = useState(person.allowed_products || []);
  const [sectionList, setSectionList] = useState(person.allowed_sections || []);
  const [canCreateOrders, setCanCreateOrders] = useState(person.can_create_orders !== false);
  const [allowedStatuses, setAllowedStatuses] = useState(person.allowed_statuses || []);
  const isSubmitter = ['manager', 'logistics', 'marketer'].includes(person.role);
  const isStaff = person.role === 'staff';
  function toggleProduct(id) { setProductList(productList.includes(id) ? productList.filter(x => x !== id) : [...productList, id]); }
  function toggleSection(key) { setSectionList(sectionList.includes(key) ? sectionList.filter(x => x !== key) : [...sectionList, key]); }
  function toggleStatus(s) { setAllowedStatuses(allowedStatuses.includes(s) ? allowedStatuses.filter(x => x !== s) : [...allowedStatuses, s]); }
  return (
    <div className="modal" onClick={e => e.stopPropagation()}>
      <h3>Access · {person.full_name}</h3>
      {isSubmitter && (
        <>
          <label style={{ marginTop: 0 }}>Product access</label>
          <div style={{ border: '1px solid #DEDAD0', borderRadius: '4px', padding: '8px', maxHeight: '160px', overflowY: 'auto' }}>
            {products.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '5px 2px' }}>
                <input type="checkbox" checked={productList.includes(p.id)} onChange={() => toggleProduct(p.id)} />
                {p.name}
              </label>
            ))}
          </div>
          <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '6px' }}>Leave all unchecked to give access to every product.</p>
        </>
      )}
      {isStaff && (
        <>
          <label style={{ marginTop: isSubmitter ? '14px' : 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            Can create new orders
            <span><input type="checkbox" checked={canCreateOrders} onChange={e => setCanCreateOrders(e.target.checked)} /></span>
          </label>
          <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '4px' }}>Turn off to stop this staff member from adding new orders — they can still work with orders assigned to them.</p>

          <label style={{ marginTop: '14px' }}>Which statuses can they set an order to?</label>
          <div style={{ border: '1px solid #DEDAD0', borderRadius: '4px', padding: '8px', maxHeight: '160px', overflowY: 'auto' }}>
            {STATUSES.map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '4px 2px' }}>
                <input type="checkbox" checked={allowedStatuses.includes(s)} onChange={() => toggleStatus(s)} />
                {s}
              </label>
            ))}
          </div>
          <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '6px' }}>Leave all unchecked to allow every status (New still can't be re-selected once confirmed).</p>
        </>
      )}
      <label style={{ marginTop: (isSubmitter || isStaff) ? '14px' : 0 }}>Extra section access</label>
      <div style={{ border: '1px solid #DEDAD0', borderRadius: '4px', padding: '8px', maxHeight: '160px', overflowY: 'auto' }}>
        {APP_SECTIONS.map(sec => (
          <label key={sec.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '5px 2px' }}>
            <input type="checkbox" checked={sectionList.includes(sec.key)} onChange={() => toggleSection(sec.key)} />
            {sec.label}
          </label>
        ))}
      </div>
      <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '6px' }}>Leave unchecked for their role's normal default access.</p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onSave(person.id, productList, sectionList, canCreateOrders, allowedStatuses)}>Save access</button>
      </div>
    </div>
  );
}
