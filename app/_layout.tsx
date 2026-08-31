import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  ensureFloatAlertChannel,
  attachFloatNotificationResponseListener,
} from '@/services/floatNotifications';
import { AuthGate } from '@/components/auth/AuthGate';
import { SubscriptionGate } from '@/components/subscription/SubscriptionGate';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    ensureFloatAlertChannel();
    const sub = attachFloatNotificationResponseListener();
    return () => sub.remove();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthGate>
        <SubscriptionGate>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
        </SubscriptionGate>
      </AuthGate>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
