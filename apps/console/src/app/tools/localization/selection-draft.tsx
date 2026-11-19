'use client';

import {useEffect, useState} from 'react';
import {ProductImage} from '@/components/product-image';
import {Button} from '@/components/ui/button';
import {errorMessage} from '@/lib/api';
import type {MarketDraft} from '@/lib/localization';
import {periodLabel, periodNames, referencePrice, selectionApi, type ResearchOrigin} from '@/lib/selection';
import styles from './localization.module.css';

export function useSelectionOrigin(draftId: string | undefined) {
  const [result, setResult] = useState<{id: string; origin?: ResearchOrigin; error?: string}>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function read(id: string) {
      try {
        const origin = await selectionApi.origin(id);
        if (cancelled) return;
        setResult({id, origin});
        if (origin.copy === 'running') timer = setTimeout(() => void read(id), 2000);
      } catch (error) {
        if (!cancelled) setResult(previous => ({
          id, origin: previous?.id === id ? previous.origin : undefined, error: errorMessage(error),
        }));
        if (!cancelled) timer = setTimeout(() => void read(id), 5000);
      }
    }
    void read(draftId);
    return () => {cancelled = true; clearTimeout(timer);};
  }, [draftId, retry]);

  return {
    origin: result?.id === draftId ? result?.origin : undefined,
    error: result?.id === draftId ? result?.error : undefined,
    refresh: (origin: ResearchOrigin) => {setResult({id: origin.draftId, origin}); setRetry(value => value + 1);},
  };
}

const copyHint: Record<ResearchOrigin['copy'], string> = {
  running: '正在生成目标语言文案…',
  ready: 'AI 初稿已生成，请核对文案。',
  failed: '文案生成未完成。你可以重试，也可以直接编辑草稿。',
  unconfigured: 'AI 文本模型未配置。你可以直接编辑草稿。',
};

export function SelectionReference({origin}: {origin: ResearchOrigin}) {
  const {product, period} = origin;
  return <section className={`card ${styles.panel}`}>
    <div className={styles.selectionReference}>
      <ProductImage src={product.image} alt="榜单参考图" className={styles.selectionReferenceImage}/>
      <div>
        <h3>FastMoss 榜单参考</h3>
        <p>{product.title}</p>
        <p className={styles.subtle}>{periodNames[period.type]} · {periodLabel(period)} · MYR 参考价 {referencePrice(product.price)}</p>
        <div className={styles.selectionLinks}>
          {product.fastmossUrl && <a href={product.fastmossUrl} target="_blank" rel="noreferrer">FastMoss 商品 ↗</a>}
          {product.tiktokUrl && <a href={product.tiktokUrl} target="_blank" rel="noreferrer">TikTok 商品 ↗</a>}
          <a href={`/tools/selection?dataset=${encodeURIComponent(origin.datasetId)}`}>查看来源榜单</a>
        </div>
      </div>
    </div>
    <div className={styles.selectionHint}>
      <p role="status">{copyHint[origin.copy]}</p>
      {origin.copy === 'unconfigured' && <a href="/settings/ai">打开 AI 设置</a>}
    </div>
  </section>;
}

export function SelectionVariants({draft, onChange}: {draft: MarketDraft; onChange: (patch: Partial<MarketDraft>) => void}) {
  const {specificationNames: dimensions, variants, media} = draft;
  const number = (value: string) => value === '' ? null : Number(value);

  function update(index: number, patch: Partial<MarketDraft['variants'][number]>) {
    const next = variants.map((variant, row) => row === index ? {...variant, ...patch} : variant);
    if (!media || patch.sku === undefined) {
      onChange({variants: next});
      return;
    }
    const oldSku = variants[index].sku;
    const variantImages = media.variantImages.map(assignment => assignment.sku === oldSku ? {...assignment, sku: patch.sku!} : assignment);
    onChange({variants: next, media: {...media, variantImages}});
  }

  function remove(index: number) {
    const next = variants.filter((_, row) => row !== index);
    const variantImages = media?.variantImages.filter(assignment => assignment.sku !== variants[index].sku);
    onChange({variants: next, ...(media && variantImages ? {media: {...media, variantImages}} : {})});
  }

  return <div className={styles.selectionVariants}>
    <div className={styles.heading}>
      <h3>规格、售价与库存</h3>
      <div className={styles.actions}>
        <Button type="button" variant="outline" disabled={dimensions.length >= 2} onClick={() => onChange({
          specificationNames: [...dimensions, ''], variants: variants.map(variant => ({...variant, options: [...variant.options, '']})),
        })}>添加规格维度</Button>
        <Button type="button" variant="outline" disabled={!dimensions.length || variants.length >= 100} onClick={() => onChange({
          variants: [...variants, {sku: '', options: dimensions.map(() => ''), price: null, stock: null}],
        })}>添加 SKU</Button>
      </div>
    </div>
    {dimensions.length > 0 && <div className={styles.selectionDimensions}>
      {dimensions.map((dimension, index) => <div key={index}>
        <label><span>规格维度 {index + 1}</span><input value={dimension} maxLength={100} placeholder="例如颜色" onChange={event => {
          const name = event.target.value;
          onChange({specificationNames: dimensions.map((value, position) => position === index ? name : value)});
        }}/></label>
        <Button type="button" variant="outline" disabled={dimensions.length === 1 && variants.length > 1}
          aria-label={`删除规格维度 ${index + 1}`} onClick={() => onChange({
            specificationNames: dimensions.filter((_, position) => position !== index),
            variants: variants.map(variant => ({...variant, options: variant.options.filter((_, position) => position !== index)})),
          })}>删除</Button>
      </div>)}
    </div>}
    {!dimensions.length && <p className={styles.subtle}>当前为单规格。商品有颜色或尺码时，先添加规格维度，再添加 SKU。</p>}
    <div className="table-scroll" role="region" aria-label="规格编辑" tabIndex={0}>
      <table className={styles.variants}>
        <thead><tr>
          <th scope="col">SKU</th>
          {dimensions.map((name, index) => <th scope="col" key={index}>{name || `规格 ${index + 1}`}</th>)}
          <th scope="col">最终售价 · {draft.shop.currency}</th><th scope="col">库存</th><th scope="col">操作</th>
        </tr></thead>
        <tbody>{variants.map((variant, index) => <tr key={index}>
          <td><input aria-label={`第 ${index + 1} 行 SKU`} maxLength={100} value={variant.sku} onChange={event => update(index, {sku: event.target.value})}/></td>
          {variant.options.map((value, position) => <td key={position}>
            <input aria-label={`第 ${index + 1} 行 ${dimensions[position] || '规格 ' + (position + 1)}`} maxLength={100} value={value} onChange={event => {
              const option = event.target.value;
              update(index, {options: variant.options.map((item, column) => column === position ? option : item)});
            }}/>
          </td>)}
          <td><input aria-label={`第 ${index + 1} 行最终售价`} type="number" min="0" step="0.01" value={variant.price ?? ''}
            onChange={event => update(index, {price: number(event.target.value)})}/></td>
          <td><input aria-label={`第 ${index + 1} 行库存`} type="number" min="0" step="1" value={variant.stock ?? ''}
            onChange={event => update(index, {stock: number(event.target.value)})}/></td>
          <td><Button type="button" variant="outline" aria-label={`删除第 ${index + 1} 行 SKU`} disabled={variants.length <= 1} onClick={() => remove(index)}>删除</Button></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
