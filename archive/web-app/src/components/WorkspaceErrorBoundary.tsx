import { Component, type ErrorInfo, type ReactNode } from "react";

export default class WorkspaceErrorBoundary extends Component<{
  children: ReactNode;
  resetKey: string;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Workspace view failed", error, info.componentStack);
  }

  render() {
    if (this.state.failed) return <div className="empty-state" role="alert"><strong>This view could not load.</strong><p>Your data is unchanged. Open another section and try again.</p></div>;
    return this.props.children;
  }
}
