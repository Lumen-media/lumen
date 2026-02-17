import { createRouter, RouterProvider } from "@tanstack/react-router";
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./App.css";
import "./i18n";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
const router = createRouter({ routeTree });

// Register the router instance for type safety
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

// Error Boundary para capturar erros globais
const GlobalErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  return (
    <ErrorBoundary
      fallback={(error) => (
        <div style={{ padding: '20px', fontFamily: 'monospace' }}>
          <h1>Erro Global no Aplicativo</h1>
          <pre>{error.message}</pre>
          <pre>{error.stack}</pre>
          <button onClick={() => window.location.reload()}>Recarregar</button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
};

// Componente ErrorBoundary simples
const ErrorBoundary = ({ 
  children, 
  fallback 
}: { 
  children: React.ReactNode; 
  fallback: (error: Error) => React.ReactNode;
}) => {
  const [hasError, setHasError] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Erro global capturado:', event.error);
      setError(event.error);
      setHasError(true);
    };

    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError && error) {
    return <>{fallback(error)}</>;
  }

  return <>{children}</>;
};

console.log("Aplicativo iniciando...");

try {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <GlobalErrorBoundary>
        <RouterProvider router={router} />
      </GlobalErrorBoundary>
    </StrictMode>,
  );
} catch (error) {
  console.error("Erro fatal ao renderizar aplicativo:", error);
  document.getElementById("root")!.innerHTML = `
    <div style="padding: 20px; font-family: monospace;">
      <h1>Erro Fatal</h1>
      <pre>${error instanceof Error ? error.message : String(error)}</pre>
      <button onclick="window.location.reload()">Recarregar</button>
    </div>
  `;
}
