import React, { Component, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error boundary caught error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleRetry);
      }

      return (
        <Card className="p-6 m-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="size-12 text-destructive" />
            <div className="space-y-2">
              <h3 className="font-bold text-lg">Something went wrong</h3>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred. Please try again.
              </p>
              <p className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded max-w-md">
                {this.state.error.message}
              </p>
            </div>
            <Button onClick={this.handleRetry}>
              Try Again
            </Button>
          </div>
        </Card>
      );
    }

    return this.props.children;
  }
}
