'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const STATUS_STEPS = ['New', 'Confirmed', 'Preparing', 'Dispatched', 'Delivered'];

export default function TrackPage() {
  const params = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: params.id }),
        });
        const body = await res.json();
        if (!res.ok) { setError(body.error || 'Order not found.'); setLoading(false); return; }
        setOrder(body);
      } catch (e) {
        setError('Something went wrong loading your order.');
      }
      setLoading(false);
    })();
  }, [params.id]);

  const stepIndex = order ? STATUS_STEPS.indexOf(order.status) : -1;
  const isOffTrack = order && !STATUS_STEPS.includes(order.status);

  return (
    <div style={{
      minHeight: '100vh', background: '#1F4D44', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontFamily: "'Inter', -apple-system, sans-serif", padding: '24px',
    }}>
      <div style={{ background: '#F6F4EF', borderRadius: '10px', padding: '32px 28px', width: '380px', maxWidth: '100%', boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}>
        <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '15px', color: '#1F4D44', marginBottom: '4px' }}>Northline Dispatch</div>
        <h1 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '22px', margin: '0 0 16px 0' }}>Track your order</h1>

        {loading && <p style={{ color: '#4B5566', fontSize: '14px' }}>Loading…</p>}

        {!loading && error && (
          <p style={{ color: '#B0483F', fontSize: '14px' }}>{error} Please check the link and try again, or contact us directly.</p>
        )}

        {!loading && order && (
          <>
            <p style={{ fontSize: '15px', color: '#1B2430', marginBottom: '18px' }}>
              Hi {order.customer_first_name}, {order.message}
            </p>

            {!isOffTrack && (
              <div style={{ marginBottom: '20px' }}>
                {STATUS_STEPS.map((step, i) => (
                  <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <div style={{
                      width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                      background: i <= stepIndex ? '#2E6E62' : '#DEDAD0',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '11px',
                    }}>
                      {i <= stepIndex ? '✓' : ''}
                    </div>
                    <span style={{ fontSize: '13.5px', color: i <= stepIndex ? '#1B2430' : '#8A93A0', fontWeight: i === stepIndex ? 600 : 400 }}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {isOffTrack && (
              <div style={{ background: '#F1E8D8', borderRadius: '6px', padding: '12px 14px', marginBottom: '18px' }}>
                <span style={{ fontSize: '13.5px', color: '#8A5E1F', fontWeight: 600 }}>{order.status}</span>
              </div>
            )}

            {order.product_name && (
              <div style={{ fontSize: '12.5px', color: '#4B5566', marginBottom: '6px' }}><strong>Item:</strong> {order.product_name}</div>
            )}
            {order.preferred_time && (
              <div style={{ fontSize: '12.5px', color: '#4B5566', marginBottom: '6px' }}><strong>Preferred delivery time:</strong> {order.preferred_time}</div>
            )}
            {order.reschedule_date && (
              <div style={{ fontSize: '12.5px', color: '#4B5566', marginBottom: '6px' }}><strong>Rescheduled for:</strong> {order.reschedule_date}</div>
            )}

            <p style={{ fontSize: '11px', color: '#8A93A0', marginTop: '18px' }}>Order ref: {order.id.slice(0, 8)}</p>
          </>
        )}
      </div>
    </div>
  );
}
