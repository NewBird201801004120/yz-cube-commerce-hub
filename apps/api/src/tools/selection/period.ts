import {BadRequestException} from '@nestjs/common';

export type Period = {type: 'day' | 'week' | 'month'; value: string};

export function parsePeriod(input: unknown): Period {
  const period = input as Partial<Period> | undefined;
  const type = period?.type, value = period?.value;
  if (type === 'month' && typeof value === 'string' && /^[2-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) return {type, value};
  if ((type === 'day' || type === 'week') && typeof value === 'string' && /^[2-9]\d{3}-\d\d-\d\d$/.test(value)) {
    const date = new Date(value + 'T00:00:00Z');
    if (!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
      && (type === 'day' || date.getUTCDay() === 1)) return {type, value};
  }
  throw new BadRequestException('请选择有效的日榜、周榜或月榜日期');
}
