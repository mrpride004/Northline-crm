'use client';
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { STATUSES, logEvent, orderTotal, ReportsPage, InventoryPage, OrderHistoryModal, CustomerHistoryModal, NotificationsBell } from './features';

export default function Dashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [profiles, setProfiles] = useState([]);

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
    const [{ data: prod }, { data: ord }, { data: profs }] = await Promise.all([
      supabase.from('products').select('*').order('created_at'),
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*'),
    ]);
    setProducts(prod || []);
    setOrders(ord || []);
    setProfiles(profs || []);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (loading) return <div className="loading">Loading your workspace…</div>;
  if (!profile) return <div className="loading">Your account has no role assigned yet. Ask your admin to set one in Supabase.</div>;

  const isAdmin = profile.role === 'admin';
  const myOrders = isAdmin ? orders
    : profile.role === 'staff' ? orders.filter(o => o.staff_id === profile.id)
    : orders.filter(o => o.dispatch_id === profile.id);

  const navItems = isAdmin ? [
    { key: 'dashboard', label: 'Overview' },
    { key: 'orders', label: 'All orders', count: orders.length },
    { key: 'products', label: 'Products' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'team', label: 'Staff & dispatch' },
    { key: 'reports', label: 'Reports' },
  ] : profile.role === 'staff' ? [
    { key: 'dashboard', label: 'My orders', count: myOrders.filter(o => o.status !== 'Delivered' && o.status !== 'Cancelled').length },
    { key: 'unassigned', label: 'Unassigned pool', count: orders.filter(o => !o.staff_id).length },
  ] : [
    { key: 'dashboard', label: 'My deliveries', count: myOrders.filter(o => o.status === 'Dispatched').length },
  ];

  return (
    <div className="app">
      <div className="sidebar">
        <div className="brand">
          <p className="brand-name">Northline</p>
          <div className="brand-role">{profile.full_name} · {profile.role === 'admin' ? 'Admin' : profile.role === 'staff' ? 'Staff' : 'Dispatch partner'}</div>
        </div>
        <div className="nav">
          {navItems.map(n => (
            <div key={n.key} className={'nav-item' + (page === n.key ? ' active' : '')} onClick={() => setPage(n.key)}>
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
        {isAdmin && page === 'dashboard' && <AdminOverview orders={orders} products={products} profiles={profiles} />}
        {isAdmin && page === 'orders' && <OrdersPage orders={orders} products={products} profiles={profiles} isAdmin profile={profile} refresh={refreshAll} />}
        {isAdmin && page === 'products' && <ProductsPage products={products} orders={orders} refresh={refreshAll} />}
        {isAdmin && page === 'inventory' && <InventoryPage products={products} orders={orders} refresh={refreshAll} />}
        {isAdmin && page === 'team' && <TeamPage profiles={profiles} orders={orders} session={session} refresh={refreshAll} />}
        {isAdmin && page === 'reports' && <ReportsPage orders={orders} profiles={profiles} />}

        {profile.role === 'staff' && page === 'dashboard' && <OrdersPage orders={myOrders} products={products} profiles={profiles} title="My orders" myId={profile.id} myRole="staff" profile={profile} refresh={refreshAll} />}
        {profile.role === 'staff' && page === 'unassigned' && <UnassignedPage orders={orders.filter(o => !o.staff_id)} products={products} myId={profile.id} profile={profile} refresh={refreshAll} />}

        {profile.role === 'dispatch' && page === 'dashboard' && <DispatchPage orders={myOrders} products={products} profile={profile} refresh={refreshAll} />}
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

function OrderModal({ products, order, onSave, onClose }) {
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

  function save() {
    if (!customer.trim() || !productId) return;
    onSave({
      product_id: productId, customer: customer.trim(), phone: phone.trim(), address: address.trim(), notes: notes.trim(),
      quantity: parseInt(quantity, 10) || 1,
      unit_price: unitPrice === '' ? null : parseFloat(unitPrice),
      delivery_fee: parseFloat(deliveryFee) || 0,
      payment_status: paymentStatus,
      reschedule_date: rescheduleDate || null,
    });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{order ? 'Edit order' : 'New order'}</h3>
        <label>Product</label>
        <select value={productId} onChange={e => setProductId(e.target.value)}>
          {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.stock_quantity ?? 0} in stock)</option>)}
        </select>
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
        <label>Delivery address</label>
        <textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, city, landmark" />
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
  const staffList = profiles.filter(p => p.role === 'staff');
  const dispatchList = profiles.filter(p => p.role === 'dispatch');
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Assign order</h3>
        <label>Staff member</label>
        <select value={staffId} onChange={e => setStaffId(e.target.value)}>
          <option value="">— Unassigned —</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <label>Dispatch partner</label>
        <select value={dispatchId} onChange={e => setDispatchId(e.target.value)}>
          <option value="">— Unassigned —</option>
          {dispatchList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSave({ staff_id: staffId || null, dispatch_id: dispatchId || null })}>Save</button>
        </div>
      </div>
    </div>
  );
}

function OrdersPage({ orders, products, profiles, isAdmin, title, myId, myRole, profile, refresh }) {
  const [activeProduct, setActiveProduct] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [historyOrder, setHistoryOrder] = useState(null);
  const [customerView, setCustomerView] = useState(null);

  const filtered = activeProduct === 'all' ? orders : orders.filter(o => o.product_id === activeProduct);
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  const staffName = id => (profiles.find(s => s.id === id) || {}).full_name || '—';

  async function createOrder(fields) {
    const { data, error } = await supabase.from('orders').insert(fields).select().single();
    setShowNew(false);
    if (!error && data) {
      const product = products.find(p => p.id === fields.product_id);
      if (product) {
        await supabase.from('products').update({ stock_quantity: Math.max(0, product.stock_quantity - (fields.quantity || 1)) }).eq('id', product.id);
      }
      await logEvent({ order_id: data.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'created', note: 'Order created' });
    }
    refresh();
  }
  async function updateOrder(id, patch, meta) {
    const current = orders.find(o => o.id === id);
    if (patch.status === 'Delivered') patch.delivered_at = new Date().toISOString();
    await supabase.from('orders').update(patch).eq('id', id);
    if (patch.status && current && patch.status !== current.status) {
      await logEvent({ order_id: id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'status_change', from_status: current.status, to_status: patch.status });
    }
    if (meta === 'assigned') {
      await logEvent({ order_id: id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'assigned', note: 'Assignment updated' });
    }
    refresh();
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1 className="page-title">{title || 'All orders'}</h1>
          <p className="page-sub">{filtered.length} order{filtered.length !== 1 ? 's' : ''}{activeProduct !== 'all' ? ' · ' + prodName(activeProduct) : ''}</p>
        </div>
        {isAdmin && <button className="btn primary" onClick={() => setShowNew(true)}>+ New order</button>}
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
                  <div style={{ fontSize: '11px', color: '#8A93A0' }}>{o.phone}</div>
                </td>
                <td style={{ fontSize: '12px' }}>
                  <span className={'pill ' + (o.payment_status === 'Paid' ? 'Delivered' : o.payment_status === 'Partial' ? 'Preparing' : 'Cancelled')}>{o.payment_status || 'Unpaid'}</span>
                  <div style={{ color: '#8A93A0', marginTop: '3px' }}>₦{orderTotal(o).toLocaleString()}</div>
                </td>
                <td style={{ fontSize: '12px' }}>
                  {o.staff_id ? staffName(o.staff_id) : <span style={{ color: '#B0483F' }}>Unassigned staff</span>}
                  {o.dispatch_id ? <div style={{ color: '#8A93A0' }}>{staffName(o.dispatch_id)}</div> : null}
                </td>
                <td>
                  {isAdmin || (myRole === 'staff' && o.staff_id === myId) ? (
                    <select className="status-sel" value={o.status} onChange={e => updateOrder(o.id, { status: e.target.value })}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : <span className={'pill ' + o.status}>{o.status}</span>}
                  {o.status === 'Rescheduled' && o.reschedule_date && <div style={{ fontSize: '10.5px', color: '#8A93A0', marginTop: '3px' }}>→ {o.reschedule_date}</div>}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="link-btn" onClick={() => setHistoryOrder(o)}>History</button>{' · '}
                  {isAdmin && <>
                    <button className="link-btn" onClick={() => setAssigning(o)}>Assign</button>{' · '}
                    <button className="link-btn" onClick={() => setEditing(o)}>Edit</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && <OrderModal products={products} onClose={() => setShowNew(false)} onSave={createOrder} />}
      {editing && <OrderModal products={products} order={editing} onClose={() => setEditing(null)} onSave={(fields) => { updateOrder(editing.id, fields); setEditing(null); }} />}
      {assigning && <AssignModal order={assigning} profiles={profiles} onClose={() => setAssigning(null)} onSave={(patch) => { updateOrder(assigning.id, patch, 'assigned'); setAssigning(null); }} />}
      {historyOrder && <OrderHistoryModal order={historyOrder} profile={profile} onClose={() => setHistoryOrder(null)} onLogged={refresh} />}
      {customerView && <CustomerHistoryModal phone={customerView.phone} customer={customerView.customer} orders={orders} products={products} onClose={() => setCustomerView(null)} />}
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

function DispatchPage({ orders, products, profile, refresh }) {
  const prodName = id => (products.find(p => p.id === id) || {}).name || '—';
  async function setStatus(o, status) {
    const patch = { status };
    if (status === 'Delivered') patch.delivered_at = new Date().toISOString();
    await supabase.from('orders').update(patch).eq('id', o.id);
    await logEvent({ order_id: o.id, actor_id: profile?.id, actor_name: profile?.full_name, event_type: 'status_change', from_status: o.status, to_status: status });
    refresh();
  }
  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">My deliveries</h1><p className="page-sub">Orders assigned to you for dispatch.</p></div></div>
      {orders.length === 0 ? <div className="empty">No deliveries assigned to you yet.</div> : (
        <table>
          <thead><tr><th>Order</th><th>Product</th><th>Customer</th><th>Address</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td className="oid">{o.id.slice(0, 8)}</td>
                <td>{prodName(o.product_id)}</td>
                <td>{o.customer}<div style={{ fontSize: '11px', color: '#8A93A0' }}>{o.phone}</div></td>
                <td style={{ fontSize: '12px', maxWidth: '220px' }}>{o.address || '—'}</td>
                <td><span className={'pill ' + o.status}>{o.status}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {o.status !== 'Delivered' && <>
                    <button className="btn primary" onClick={() => setStatus(o, 'Delivered')}>Delivered</button>{' '}
                    <button className="btn" onClick={() => setStatus(o, 'Unreachable')}>Unreachable</button>{' '}
                    <button className="btn" onClick={() => setStatus(o, 'Rescheduled')}>Reschedule</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProductsPage({ products, orders, refresh }) {
  const [name, setName] = useState('');
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
      <div className="topbar"><div><h1 className="page-title">Products</h1><p className="page-sub">Each product gets its own order queue and tab.</p></div></div>
      <div className="list-manage" style={{ marginBottom: '18px' }}>
        {products.map(p => (
          <div key={p.id} className="list-manage-row">
            <span>{p.name} <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>· {orders.filter(o => o.product_id === p.id).length} orders</span></span>
            <button className="tiny-x" onClick={() => remove(p.id)}>Remove</button>
          </div>
        ))}
        {products.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No products yet.</div>}
      </div>
      <div className="row2" style={{ maxWidth: '420px' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New product name" />
        <button className="btn primary" onClick={add} style={{ flex: '0 0 auto' }}>Add product</button>
      </div>
    </div>
  );
}

function TeamPage({ profiles, orders, session, refresh }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [status, setStatus] = useState('');
  const staffList = profiles.filter(p => p.role !== 'admin');

  async function createLogin() {
    if (!name.trim() || !email.trim() || password.length < 6) {
      setStatus('Fill in a name, email, and a password of at least 6 characters.');
      return;
    }
    setStatus('Creating login…');
    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ full_name: name.trim(), email: email.trim(), password, role }),
    });
    const body = await res.json();
    if (!res.ok) { setStatus(body.error || 'Something went wrong.'); return; }
    setStatus(`Login created for ${name.trim()}.`);
    setName(''); setEmail(''); setPassword('');
    refresh();
  }

  return (
    <div>
      <div className="topbar"><div><h1 className="page-title">Staff & dispatch partners</h1><p className="page-sub">Create a real login for each person — they'll sign in with the email and password you set here.</p></div></div>

      <div className="list-manage" style={{ marginBottom: '18px' }}>
        {staffList.map(s => {
          const load = orders.filter(o => (s.role === 'staff' ? o.staff_id : o.dispatch_id) === s.id).length;
          return <div key={s.id} className="list-manage-row"><span>{s.full_name} <span style={{ color: '#8A93A0', fontSize: '11.5px' }}>({s.role}) · {load} orders</span></span></div>;
        })}
        {staffList.length === 0 && <div className="list-manage-row" style={{ color: '#8A93A0' }}>No one added yet.</div>}
      </div>

      <div style={{ background: '#fff', border: '1px solid #DEDAD0', borderRadius: '8px', padding: '18px', maxWidth: '440px' }}>
        <label className="field-label" style={{ marginTop: 0 }}>Full name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Chidi Okafor" style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
        <label className="field-label">Email (their login)</label>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
        <label className="field-label">Temporary password</label>
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" style={{ width: '100%', marginBottom: '10px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }} />
        <label className="field-label">Role</label>
        <select value={role} onChange={e => setRole(e.target.value)} style={{ width: '100%', marginBottom: '12px', padding: '9px 11px', border: '1px solid #DEDAD0', borderRadius: '4px' }}>
          <option value="staff">Staff</option>
          <option value="dispatch">Dispatch partner</option>
        </select>
        <button className="btn primary" onClick={createLogin} style={{ width: '100%' }}>Create login</button>
        {status && <p style={{ fontSize: '12px', color: '#4B5566', marginTop: '10px' }}>{status}</p>}
      </div>
    </div>
  );
}
