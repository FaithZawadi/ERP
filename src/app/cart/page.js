import CartContent from './CartContent';

export const metadata = {
  title: 'Your Cart | QSL Shop',
  robots: { index: false, follow: true },
};

export default function CartPage() {
  return <CartContent />;
}
