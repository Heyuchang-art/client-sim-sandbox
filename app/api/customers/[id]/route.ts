import { generateCustomers } from '../../../../lib/simulation';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const customer = generateCustomers(1000, 20260830).find((item) => item.id === id);
  if (!customer) return Response.json({ error: '未找到客户。' }, { status: 404 });
  return Response.json({ customer, dataClassification: 'synthetic-and-masked' });
}
