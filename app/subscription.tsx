import { useRouter } from 'expo-router';
import { SubscriptionPaymentScreen } from '@/components/subscription/SubscriptionGate';

/**
 * Voluntary access to subscription status/payment — linked from
 * Settings so an agent can check days remaining or renew early,
 * without needing to wait until access actually lapses (which is
 * when SubscriptionGate would otherwise force this same screen).
 */
export default function SubscriptionScreen() {
  const router = useRouter();
  return <SubscriptionPaymentScreen mode="voluntary" onBack={() => router.back()} />;
}
