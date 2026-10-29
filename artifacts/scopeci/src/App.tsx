import type { ComponentProps, ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getGetSessionQueryKey } from '@workspace/api-client-react';
import { ThemeProvider } from 'next-themes';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { OfflineNotice } from '@/components/offline-notice';
import Home from '@/pages/home';
import Privacy from '@/pages/privacy';
import Terms from '@/pages/terms';
import Security from '@/pages/security';
import Contact from '@/pages/contact';
import Pricing from '@/pages/pricing';
import TryPage from '@/pages/try';
import AppPage from '@/pages/app';
import AdminWaitlist from '@/pages/admin';
import NotFound from '@/pages/not-found';
import { withViewTransition } from '@/motion';

const statusOf = (error: unknown) => (error as { status?: number } | null)?.status;

/**
 * When any request finds the session gone (it expired, or they signed out in
 * another tab), check the session again: the app then shows the sign-in page
 * instead of a row of errors. GitHub's own expired access also answers 401,
 * but the session check simply comes back signed in.
 */
function onAnyError(error: unknown) {
  if (statusOf(error) === 401) queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAnyError }),
  mutationCache: new MutationCache({ onError: onAnyError }),
  defaultOptions: {
    queries: {
      // Asking again only helps when the network or the server stumbled;
      // a 404 or a 403 will say the same thing a second time.
      retry: (failures, error) => {
        const status = statusOf(error);
        return failures < 2 && (status === undefined || status >= 500);
      },
    },
    // By default React Query pauses a mutation while the browser reports
    // being offline, which leaves the button spinning with no explanation.
    // Let it fail instead, so the form can say the connection is the problem.
    mutations: { networkMode: 'always' },
  },
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
        <Route path="/terms" component={Terms} />
        <Route path="/security" component={Security} />
        <Route path="/contact" component={Contact} />
        <Route path="/pricing" component={Pricing} />
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
        <OfflineNotice />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
