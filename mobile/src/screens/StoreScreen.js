// Catalogue → variant picker → cart → mock-gateway checkout → receipt (view + PDF download).
import React, { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { Button, Card, EmptyState, Field, Loading, Message } from '../components/ui';
import { getServerUrl } from '../config';
import { money } from '../format';
import { loadSession } from '../session';
import { theme } from '../theme';
import { useCached } from '../useCached';

const CARDS = [
  { token: 'tok_success', label: 'Test card — approved' },
  { token: 'tok_declined', label: 'Test card — declined' },
  { token: 'tok_capture_fail', label: 'Test card — capture fails' },
];

export default function StoreScreen() {
  const q = useCached('products', '/api/v1/store/products');
  const [variant, setVariant] = useState(null);
  const [cart, setCart] = useState({});
  const [code, setCode] = useState('');
  const [card, setCard] = useState('tok_success');
  const [msg, setMsg] = useState({ kind: 'info', text: '' });
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  if (q.loading) return <Loading label="Loading store…" />;
  const products = q.data || [];
  const variants = Object.fromEntries(products.flatMap((p) => p.variants.map((v) => [v.variant_id, { ...v, product: p.name }])));
  const lines = Object.entries(cart).filter(([, n]) => n > 0);
  const subtotal = lines.reduce((s, [v, n]) => s + variants[v].price_minor * n, 0);

  const add = () => {
    if (!variant) return setMsg({ kind: 'error', text: 'Choose a size first.' });
    const n = (cart[variant] || 0) + 1;
    if (n > variants[variant].stock) return setMsg({ kind: 'error', text: 'Not enough stock for that size.' });
    setCart({ ...cart, [variant]: n });
    setMsg({ kind: 'success', text: 'Added to cart.' });
  };

  const pay = async () => {
    setBusy(true);
    setMsg({ kind: 'info', text: '' });
    try {
      const r = await api('/api/v1/store/checkout', { method: 'POST', body: {
        order_id: `app-${Date.now().toString(36)}`, items: lines.map(([variant_id, quantity]) => ({ variant_id, quantity })),
        discount_code: code.trim() ? code.trim().toUpperCase() : null, payment: { token: card },
      } });
      setReceipt(r);
      setCart({});
      q.reload();
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const confirmPay = () => Alert.alert('Confirm payment', `Pay ${money(subtotal)} before discounts?`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Pay now', onPress: pay },
  ]);

  const openPdf = async () => {
    const base = await getServerUrl();
    const s = await loadSession();
    Linking.openURL(`${base}/api/v1/receipts/${receipt.order_id}.pdf?t=${encodeURIComponent(s.token)}`);
  };

  if (receipt) {
    return (
      <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}>
        <Card>
          <Text style={styles.ok}>✓ Payment successful</Text>
          <Text style={styles.title}>Receipt {receipt.order_id}</Text>
          {receipt.items.map((i) => (
            <Text key={i.variant_id} style={styles.line}>{variants[i.variant_id] ? variants[i.variant_id].product + ' · ' + variants[i.variant_id].size : i.variant_id} × {i.quantity} — {money(i.unit_price_minor * i.quantity)}</Text>
          ))}
          <Text style={styles.line}>Subtotal: {money(receipt.subtotal_minor)}</Text>
          <Text style={styles.line}>Discount: −{money(receipt.discount_minor)}</Text>
          <Text style={styles.total}>Total paid: {money(receipt.total_minor)}</Text>
          <Text style={styles.meta}>Paid {new Date(receipt.receipt.payload.paid_at).toLocaleString()}</Text>
        </Card>
        <Button title="Download PDF receipt" onPress={openPdf} />
        <Button title="Back to store" variant="secondary" onPress={() => setReceipt(null)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ padding: theme.space(2) }}>
      <Message kind={msg.kind} text={msg.text || q.error} />
      {products.length === 0 ? <EmptyState title="No products yet" hint="The club store has nothing for sale right now." /> : null}
      {products.map((p) => (
        <Card key={p.product_id}>
          <Text style={styles.title}>{p.name}</Text>
          <Text style={styles.meta}>{p.description}</Text>
          <Text style={styles.price}>{money(p.variants[0].price_minor)}</Text>
          <Text style={styles.label}>Size</Text>
          <View style={styles.row}>
            {p.variants.map((v) => (
              <View key={v.variant_id} style={{ flex: 1, marginHorizontal: 2 }}>
                <Button title={`${variant === v.variant_id ? '✓ ' : ''}${v.size}${v.stock === 0 ? ' (sold out)' : ''}`}
                  variant={variant === v.variant_id ? 'primary' : 'secondary'} disabled={v.stock === 0}
                  onPress={() => setVariant(v.variant_id)} />
              </View>
            ))}
          </View>
          <Button title="Add to cart" onPress={add} />
        </Card>
      ))}
      <Text style={styles.h}>Cart</Text>
      <Card>
        {lines.length === 0 ? <Text style={styles.meta}>Your cart is empty.</Text> : lines.map(([v, n]) => (
          <View key={v} style={styles.cartLine}>
            <Text style={styles.line}>{variants[v].product} · {variants[v].size} × {n}</Text>
            <Button title="Remove" variant="secondary" onPress={() => setCart({ ...cart, [v]: 0 })} />
          </View>
        ))}
        {lines.length ? <Text style={styles.total}>Subtotal: {money(subtotal)}</Text> : null}
      </Card>
      {lines.length ? (
        <>
          <Field label="Discount code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="e.g. WELCOME10" />
          <Text style={styles.label}>Payment method (mock gateway)</Text>
          {CARDS.map((c) => (
            <Button key={c.token} title={(card === c.token ? '✓ ' : '') + c.label} variant={card === c.token ? 'primary' : 'secondary'}
              onPress={() => setCard(c.token)} />
          ))}
          <View style={{ marginTop: theme.space(2) }}>
            <Button title={`Buy now · ${money(subtotal)}`} variant="accent" onPress={confirmPay} loading={busy} />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '800', color: theme.text },
  meta: { fontSize: theme.font.small, color: theme.muted, marginVertical: 4 },
  price: { fontSize: 20, fontWeight: '800', color: theme.primary, marginVertical: 6 },
  label: { fontSize: theme.font.small, fontWeight: '600', color: theme.text, marginTop: theme.space(1) },
  row: { flexDirection: 'row' },
  h: { fontSize: 18, fontWeight: '700', color: theme.text, marginVertical: theme.space(1) },
  line: { fontSize: theme.font.body, color: theme.text, marginVertical: 2, flex: 1 },
  cartLine: { flexDirection: 'row', alignItems: 'center' },
  total: { fontSize: 18, fontWeight: '800', color: theme.text, marginTop: theme.space(1) },
  ok: { fontSize: theme.font.body, fontWeight: '700', color: theme.success, marginBottom: 6 },
});
