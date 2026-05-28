import React from 'react';

interface Props {
  moduleId: string;
  panelId: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ModuleErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(
      `[module:${this.props.moduleId}] panel "${this.props.panelId}" render error:`,
      error,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-center text-sm">
          <span className="text-destructive font-medium">Module panel faulted</span>
          <span className="text-muted-foreground text-xs">{this.props.moduleId}</span>
          <button
            type="button"
            className="text-xs underline"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
