import { Component, type ReactNode } from "react";

interface PilotErrorBoundaryProps {
  children: ReactNode;
  onFailure: (error: Error) => void;
}

interface PilotErrorBoundaryState {
  failed: boolean;
}

export default class PilotErrorBoundary extends Component<PilotErrorBoundaryProps, PilotErrorBoundaryState> {
  state: PilotErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PilotErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onFailure(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
