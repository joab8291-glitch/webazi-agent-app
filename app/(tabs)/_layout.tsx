import { Tabs } from 'expo-router';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Gradients, cardShadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const TAB_ICON: Record<string, Parameters<typeof IconSymbol>[0]['name']> = {
  index: 'house.fill',
  transactions: 'list.bullet',
  'data-plans-manager': 'simcard.fill',
  settings: 'gearshape.fill',
};

export default function TabLayout() {
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];
  const gradient = Gradients[colorScheme].tint;
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: c.onTint,
        tabBarInactiveTintColor: c.textSecondary,
        tabBarHideOnKeyboard: true,
        tabBarStyle: [
          styles.tabbar,
          {
            bottom: insets.bottom + 14,
            backgroundColor: c.surface,
            borderColor: c.border,
          },
          cardShadow(),
        ],
        tabBarItemStyle: styles.tabbarItem,
        tabBarIcon: ({ focused, color }) => (
          <TabPill focused={focused} gradient={gradient}>
            <IconSymbol size={20} name={TAB_ICON[route.name] ?? 'house.fill'} color={color} />
          </TabPill>
        ),
      })}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="transactions" options={{ title: 'Orders' }} />
      <Tabs.Screen name="data-plans-manager" options={{ title: 'Data Plans' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      {/* Hide old explore template */}
      <Tabs.Screen name="explore" options={{ href: null }} />
      {/* Reachable via a link from Settings, not a bottom tab */}
      <Tabs.Screen name="ussd-scheduler" options={{ href: null }} />
      <Tabs.Screen name="mpesa-messages" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}

function TabPill({
  focused,
  gradient,
  children,
}: {
  focused: boolean;
  gradient: readonly [string, string];
  children: React.ReactNode;
}) {
  if (!focused) {
    return <View style={styles.tabIconWrap}>{children}</View>;
  }
  return (
    <LinearGradient colors={gradient} style={styles.tabIconWrap}>
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  tabbar: {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 64,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingTop: 0,
    paddingBottom: 0,
    elevation: 8,
  },
  tabbarItem: {
    height: 64,
    paddingTop: 0,
  },
  tabIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
