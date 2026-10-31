import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../api.dart';
import '../theme.dart';

/// The React campus scene, wrapped in a WebView.
///
/// Why a WebView instead of native 3D: the scene is ~1,300 lines of
/// react-three-fiber with a programmatic camera rig. Flutter has no mature
/// equivalent, so wrapping the real thing gives pixel-identical output today.
///
/// Touch: react-three-fiber binds pointer events, which Android synthesises
/// from taps and drags, so tap-to-select and pinch-zoom work. The `touch-action`
/// CSS in the web app matters — see README note.
class Campus3DScreen extends StatefulWidget {
  const Campus3DScreen({super.key});

  @override
  State<Campus3DScreen> createState() => _Campus3DScreenState();
}

class _Campus3DScreenState extends State<Campus3DScreen> {
  late final WebViewController _controller;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(T.bg)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) async {
            // The web app is desktop-first: a fixed sidebar eats ~55% of a
            // phone screen. Rather than change Harshavi's components, hide the
            // chrome from inside the WebView. Contained here on purpose.
            await _controller.runJavaScript('''
              (function() {
                var s = document.createElement('style');
                s.textContent = `
                  aside { display: none !important; }
                  body { overflow: hidden !important; }
                  canvas { touch-action: none !important; }
                `;
                document.head.appendChild(s);
              })();
            ''');
            if (mounted) setState(() => _loading = false);
          },
          onWebResourceError: (e) {
            if (mounted) setState(() => _loading = false);
          },
        ),
      )
      ..loadRequest(Uri.parse('${Api.baseUrl}/'));
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        WebViewWidget(controller: _controller),
        if (_loading)
          const Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(color: T.accent, strokeWidth: 2),
                SizedBox(height: 12),
                Text('Loading campus…',
                    style: TextStyle(fontSize: 12, color: T.muted)),
              ],
            ),
          ),
        // Hint bar: pinch and drag don't work if the WebView eats the gesture,
        // and a stale touch-action silently disables them.
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            color: T.bg.withValues(alpha: 0.85),
            child: Row(
              children: [
                const Icon(Icons.touch_app, size: 14, color: T.muted),
                const SizedBox(width: 6),
                const Expanded(
                  child: Text(
                    'Tap a building · pinch to zoom · drag to orbit',
                    style: TextStyle(fontSize: 10, color: T.muted),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.refresh, size: 16, color: T.muted),
                  visualDensity: VisualDensity.compact,
                  onPressed: () {
                    setState(() => _loading = true);
                    _controller.reload();
                  },
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
