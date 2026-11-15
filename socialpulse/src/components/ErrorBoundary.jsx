import { Component } from "react";

/**
 * Last line of defence against a white page.
 *
 * A throw anywhere in render used to unmount the whole tree and leave the user staring at an empty
 * document with no way back. This catches it, keeps the app mounted enough to explain what happened
 * and offers a reload / go-home path. It sits OUTSIDE the router on purpose: a crash in a route
 * element (or in a provider) must not take the fallback down with it.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept in the console rather than swallowed: this is the only diagnostic trail the app has.
    console.error("Unhandled UI error:", error, info?.componentStack);
  }

  hardReload = () => {
    window.location.reload();
  };

  goHome = () => {
    window.location.assign("/");
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-card">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white">
              !
            </span>
            <h1 className="text-lg font-bold">Something went wrong</h1>
          </div>
          <p className="text-sm text-gray-600">
            This screen hit an unexpected error. Your data is safe — reloading usually fixes it.
          </p>
          {import.meta.env.DEV && (
            <pre className="max-h-40 overflow-auto rounded-lg bg-gray-50 p-3 text-[11px] text-red-600">
              {String(error?.message || error)}
            </pre>
          )}
          <div className="flex gap-2">
            <button
              onClick={this.hardReload}
              className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
            >
              Reload
            </button>
            <button
              onClick={this.goHome}
              className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Go to feed
            </button>
          </div>
        </div>
      </div>
    );
  }
}
