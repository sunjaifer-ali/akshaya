import { Component, type ReactNode } from "react";

export class ChartFrame extends Component<{ children: ReactNode }, { ok: boolean }> {
  state = { ok: true };

  static getDerivedStateFromError() {
    return { ok: false };
  }

  render() {
    if (!this.state.ok) return null;
    return this.props.children;
  }
}
