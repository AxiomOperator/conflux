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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const response = await fetch(`${BACKEND}/v1/admin/trajectories/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(email),
  });

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
