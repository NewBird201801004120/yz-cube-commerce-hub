import {BadRequestException, Body, Controller, Get, Param, PayloadTooLargeException, Post, Query, Req, UseGuards} from '@nestjs/common';
import type {Request} from 'express';
import {LocalizationGuard} from '../../localization';
import type {LocalizationContext} from '../../localization-platform';
import {maxWorkbookBytes} from './fastmoss';
import {SelectionService} from './selection';

type SelectionRequest = Request & {localization: LocalizationContext};
const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('localization/selection')
@UseGuards(LocalizationGuard)
export class SelectionController {
  constructor(private readonly selection: SelectionService) {}

  @Post('imports/preview')
  async preview(@Req() request: SelectionRequest, @Query('filename') filename: unknown) {
    if (!request.is(workbookType) || typeof filename !== 'string') throw new BadRequestException('请选择 .xlsx 文件');
    if (Number(request.headers['content-length']) > maxWorkbookBytes) {
      request.resume();
      throw new PayloadTooLargeException('XLSX 文件不能超过 5 MB');
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request.iterator({destroyOnReturn: false}) as AsyncIterable<Buffer>) {
      length += chunk.length;
      if (length > maxWorkbookBytes) {
        request.resume();
        throw new PayloadTooLargeException('XLSX 文件不能超过 5 MB');
      }
      chunks.push(chunk);
    }
    return this.selection.preview(request.localization.owner, filename, Buffer.concat(chunks, length));
  }

  @Post('imports')
  confirm(@Req() request: SelectionRequest, @Body() body: unknown) {
    return this.selection.confirm(request.localization.owner, body);
  }

  @Get('datasets')
  datasets(@Req() request: SelectionRequest) {
    return this.selection.datasets(request.localization.owner);
  }

  @Get('datasets/:id/products')
  products(@Req() request: SelectionRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.selection.products(request.localization.owner, id, query);
  }

  @Get('datasets/:id/analyses')
  analyses(@Req() request: SelectionRequest, @Param('id') id: string) {
    return this.selection.analyses(request.localization.owner, id);
  }

  @Post('datasets/:id/analyses')
  analyze(@Req() request: SelectionRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.selection.analyze(request.localization.owner, id, body);
  }

  @Post('analyses/:id/retry')
  retry(@Req() request: SelectionRequest, @Param('id') id: string) {
    return this.selection.retryAnalysis(request.localization.owner, id);
  }

  @Post('datasets/:id/drafts')
  follow(@Req() request: SelectionRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.selection.follow(request.localization, id, body);
  }

  @Get('drafts/:id/origin')
  origin(@Req() request: SelectionRequest, @Param('id') id: string) {
    return this.selection.origin(request.localization.owner, id);
  }

  @Post('drafts/:id/copy')
  copy(@Req() request: SelectionRequest, @Param('id') id: string) {
    return this.selection.retryCopy(request.localization.owner, id);
  }
}
