import { noContent } from '@/lib/responses';
export const dynamic = 'force-dynamic';
export async function HEAD() { return noContent(); }
export async function GET() { return noContent(); }
