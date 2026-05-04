import { NextResponse } from 'next/server';

export const ok = (data: any, init?: ResponseInit) => NextResponse.json(data, init);
export const noContent = () => new NextResponse(null, { status: 204 });
export const badRequest = (detail: string) => NextResponse.json({ detail }, { status: 400 });
export const unauthorized = (detail = 'Unauthorized') => NextResponse.json({ detail }, { status: 401 });
export const forbidden = (detail = 'Forbidden') => NextResponse.json({ detail }, { status: 403 });
export const notFound = (detail = 'Not found') => NextResponse.json({ detail }, { status: 404 });
export const serverError = (detail: string) => NextResponse.json({ detail }, { status: 500 });
