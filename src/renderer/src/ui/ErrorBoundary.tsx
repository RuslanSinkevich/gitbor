import { Component, type ReactNode, type ErrorInfo } from 'react';
import { t } from '../i18n';
import { logger } from '../shared/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('Unhandled UI error:', error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: 'var(--sg-background)', color: 'var(--sg-foreground)',
          fontFamily: 'var(--sg-font-family)', padding: 32,
        }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>{t().app.somethingWentWrong}</h2>
          <p style={{ margin: '0 0 16px', color: 'var(--sg-foreground-muted)', fontSize: 13, maxWidth: 500, textAlign: 'center' }}>
            {this.state.error?.message || t().app.unknownError}
          </p>
          <button
            className="sg-button sg-button--primary"
            onClick={this.handleReload}
          >
            {t().app.reloadUi}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
