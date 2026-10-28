import type { ComponentProps, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import Home from '@/pages/home';
import Privacy from '@/pages/privacy';
import TryPage from '@/pages/try';
import AppPage from '@/pages/app';
import AdminWaitlist from '@/pages/admin';
import NotFound from '@/pages/not-found';
import { withViewTransition } from '@/motion';

// By default React Query pauses a mutation while the browser reports being
// offline, which leaves the signup button spinning with no explanation. Let
// it fail instead, so the form can say the connection is the problem.
const queryClient = new QueryClient({
  defaultOptions: { mutations: { networkMode: 'always' } },
});

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/try" component={TryPage} />
        <Route path="/app" nest>
          <AppPage />
        </Route>
        <Route path="/admin" component={AdminWaitlist} />
        <Route path="/admin/waitlist" component={AdminWaitlist} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

// Every in-app link leads to a different page, so it starts at the top,
// inside the same transition so the new page fades in already there.
const aroundNav: NonNullable<ComponentProps<typeof WouterRouter>['aroundNav']> = (navigate, to, options) =>
  withViewTransition(() => {
    navigate(to, options);
    if (!String(to).includes('#')) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });

function App() {
  return (
    // index.html applies the same class before React loads, so the first
    // paint is already in the right theme.
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')} aroundNav={aroundNav}>
          <Router />
        </WouterRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
