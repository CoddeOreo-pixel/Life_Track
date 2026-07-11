import { useMemo } from 'react'
import type { TopApp, HourlyActivity } from '../../electron/preload'
import { Chart } from './Chart'
import { formatDuration, categoryColor } from '../lib/format'
import type { EChartsOption } from 'echarts'

// ============================================================
// 应用时间占比饼图
// ============================================================

interface PieProps {
  topApps: TopApp[]
}

export function AppPieChart({ topApps }: PieProps) {
  const option = useMemo<EChartsOption>(() => {
    const data = topApps.map((a) => ({
      name: a.app_display_name,
      value: Math.round(a.total_ms / 60000),
      itemStyle: { color: categoryColor(a.app_category) }
    }))
    const totalMin = data.reduce((s, d) => s + d.value, 0)
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: unknown) => {
          const param = p as { name: string; value: number; percent: number }
          return `${param.name}<br/>${formatDuration(param.value * 60000)} (${param.percent}%)`
        }
      },
      // 中心总时长（环形图中间文字）
      graphic: totalMin > 0
        ? {
            type: 'text',
            left: 'center',
            top: 'center',
            style: {
              text: `${totalMin}m`,
              fontSize: 22,
              fontWeight: 700,
              fill: '#f0f0f0',
              fontFamily: 'Fira Code, monospace'
            }
          }
        : undefined,
      series: [
        {
          type: 'pie',
          radius: ['52%', '72%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: '#0a0a0a',
            borderWidth: 2
          },
          label: {
            show: true,
            formatter: '{b}\n{d}%',
            fontSize: 11,
            color: '#ccc',
            lineHeight: 16
          },
          labelLine: { length: 10, length2: 10 },
          data: data.length
            ? data
            : [{ name: '暂无数据', value: 1, itemStyle: { color: '#1e1e1e' } }]
        }
      ]
    }
  }, [topApps])

  return (
    <div className="panel">
      <h2 className="panel-title">应用时间占比</h2>
      <Chart option={option} height={300} />
    </div>
  )
}

// ============================================================
// 各时段活跃度柱状图
// ============================================================

interface BarProps {
  hourly: HourlyActivity[]
}

export function HourlyBarChart({ hourly }: BarProps) {
  const option = useMemo<EChartsOption>(() => {
    const hours = hourly.map((h) => `${h.hour}:00`)
    const activeData = hourly.map((h) => Math.round(h.active_ms / 60000))
    const idleData = hourly.map((h) => Math.round(h.idle_ms / 60000))
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const arr = params as Array<{
            name: string
            value: number
            seriesName: string
          }>
          const h = arr[0]?.name ?? ''
          return `${h}<br/>${arr
            .map((p) => `${p.seriesName}: ${formatDuration(p.value * 60000)}`)
            .join('<br/>')}`
        }
      },
      legend: {
        data: ['活跃', '挂机'],
        top: 0,
        textStyle: { color: '#ccc' }
      },
      grid: { left: 40, right: 16, top: 36, bottom: 28 },
      xAxis: {
        type: 'category',
        data: hours,
        axisLabel: { color: '#888', fontSize: 10, interval: 2 }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#888', formatter: '{value}m' },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } }
      },
      series: [
        {
          name: '活跃',
          type: 'bar',
          stack: 'total',
          data: activeData,
          itemStyle: { color: '#00ff88' }
        },
        {
          name: '挂机',
          type: 'bar',
          stack: 'total',
          data: idleData,
          itemStyle: { color: '#ff8800' }
        }
      ]
    }
  }, [hourly])

  return (
    <div className="panel">
      <h2 className="panel-title">各时段活跃度分布</h2>
      <Chart option={option} height={300} />
    </div>
  )
}
