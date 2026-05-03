import { redirect } from 'next/navigation';
import { auth } from './index';

export interface ServerUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

/**
 * Use in server components / server actions when a logged-in user is required.
 * Triggers a redirect to `/auth/signin` (with the current path as callbackUrl)
 * if no session exists.
 *
 * @example
 *   const user = await requireUser();
 *   return <Dashboard userId={user.id} />;
 */
export async function requireUser(): Promise<ServerUser> {
  const session = await auth();

  if (!session?.user?.id) {
    // Middleware should already prevent unauthed access to protected pages,
    // but this is the belt-and-suspenders fallback for any route that
    // bypasses it (e.g. dynamic params, server-only entrypoints).
    redirect('/auth/signin');
  }

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };
}

/**
 * Non-throwing variant — returns `null` if no session.
 * Use in components that render differently for guests.
 */
export async function getOptionalUser(): Promise<ServerUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };
}
