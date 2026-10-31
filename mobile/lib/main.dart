import 'package:flutter/material.dart';
import 'api.dart';
import 'notifier.dart';
import 'theme.dart';
import 'screens/campus3d_screen.dart';
import 'screens/buildings_screen.dart';
import 'screens/alerts_screen.dart';
import 'screens/settings_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AlertNotifier.init();
  runApp(const TwinFraApp());
}

class TwinFraApp extends StatelessWidget {
  const TwinFraApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Twinfra',
        debugShowCheckedModeBanner: false,
        theme: T.theme(),
        home: const Shell(),
      );
}

class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _tab = 0;

  static const _titles = ['Campus', 'Buildings', 'Alerts', 'Settings'];

  @override
  void initState() {
    super.initState();
    AlertNotifier.start();
  }

  @override
  void dispose() {
    AlertNotifier.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: const BoxDecoration(
                color: T.accent,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 8),
            Text('Twinfra · ${_titles[_tab]}'),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Reload',
            icon: const Icon(Icons.refresh, size: 20, color: T.muted),
            onPressed: () => setState(() {}),
          ),
        ],
      ),
      body: IndexedStack(
        index: _tab,
        children: const [
          Campus3DScreen(),
          BuildingsScreen(),
          AlertsScreen(),
          SettingsScreen(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        backgroundColor: T.panel,
        indicatorColor: T.accent.withValues(alpha: 0.15),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.view_in_ar_outlined),
            selectedIcon: Icon(Icons.view_in_ar, color: T.accent),
            label: 'Campus',
          ),
          NavigationDestination(
            icon: Icon(Icons.apartment_outlined),
            selectedIcon: Icon(Icons.apartment, color: T.accent),
            label: 'Buildings',
          ),
          NavigationDestination(
            icon: Icon(Icons.notifications_outlined),
            selectedIcon: Icon(Icons.notifications, color: T.accent),
            label: 'Alerts',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings, color: T.accent),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
