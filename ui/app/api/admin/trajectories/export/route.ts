export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';

const BACKEND = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? '';

function adminHeaders(email: string, extra: Record<string, string> = {}) {
  return {
    'X-Internal-Secret': INTERNAL_API_SECRET,
    'X-User-Email': email,
    ...extra,
  };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.toString();
  const response = await fetch(
    `${BACKEND}/v1/admin/trajectories/export${query ? `?${query}` : ''}`,
    {
      headers: adminHeaders(email),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const data = await response.json().catch(async () => ({ detail: await response.text() }));
    return NextResponse.json(data, { status: response.status });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/x-ndjson',
      'Content-Disposition':
        response.headers.get('Content-Disposition') ?? 'attachment; filename="trajectories.jsonl"',
    },
  });
}
