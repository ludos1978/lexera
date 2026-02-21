import { DashboardScanner } from '../../dashboard/DashboardScanner';

function getDateOfISOWeek(week: number, year: number): Date {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7; // Sunday = 7
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    monday.setHours(0, 0, 0, 0);
    return monday;
}

describe('DashboardScanner temporal inheritance for time slots', () => {
    const scanSingleTemporalLine = (line: string, timeframeDays: number = 2000) => {
        const board = {
            columns: [
                {
                    title: 'Schedule',
                    cards: [
                        {
                            content: `Task\n${line}`
                        }
                    ]
                }
            ]
        };

        const result = DashboardScanner.scanBoard(
            board as any,
            'file:///tmp/board.md',
            'Board',
            timeframeDays
        );

        return result.upcomingItems[0];
    };

    it('inherits week from task title for time-only lines', () => {
        const year = new Date().getFullYear() + 1;
        const week = 25;
        const expectedDate = getDateOfISOWeek(week, year);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const board = {
            columns: [
                {
                    title: 'Schedule',
                    cards: [
                        {
                            content: [
                                `Final Presentation @${year}-kw${week}`,
                                '- [ ] @08:00-10:00 : Setup',
                                '- [ ] @10:30-12:00 : Presentations'
                            ].join('\n')
                        }
                    ]
                }
            ]
        };

        const result = DashboardScanner.scanBoard(
            board as any,
            'file:///tmp/board.md',
            'Board',
            800
        );

        const timeItems = result.upcomingItems.filter(item =>
            item.temporalTag === '@08:00-10:00' || item.temporalTag === '@10:30-12:00'
        );

        expect(timeItems).toHaveLength(2);
        for (const item of timeItems) {
            const itemDate = new Date(item.date!);
            itemDate.setHours(0, 0, 0, 0);
            expect(itemDate.getTime()).toBe(expectedDate.getTime());
            expect(itemDate.getTime()).not.toBe(today.getTime());
            expect(item.week).toBe(week);
            expect(item.year).toBe(year);
        }
    });

    it('inherits week from an earlier explicit line inside task description', () => {
        const year = new Date().getFullYear() + 1;
        const week = 25;
        const expectedDate = getDateOfISOWeek(week, year);

        const board = {
            columns: [
                {
                    title: 'Schedule',
                    cards: [
                        {
                            content: [
                                'Final Presentation',
                                `## Final Presentation @${year}-kw${week}`,
                                '- Exhibition over the full day.',
                                '- [ ] @08:00-10:00 : Setup'
                            ].join('\n')
                        }
                    ]
                }
            ]
        };

        const result = DashboardScanner.scanBoard(
            board as any,
            'file:///tmp/board.md',
            'Board',
            800
        );

        const timeItem = result.upcomingItems.find(item => item.temporalTag === '@08:00-10:00');
        expect(timeItem).toBeDefined();

        const itemDate = new Date(timeItem!.date!);
        itemDate.setHours(0, 0, 0, 0);
        expect(itemDate.getTime()).toBe(expectedDate.getTime());
        expect(timeItem!.week).toBe(week);
        expect(timeItem!.year).toBe(year);
    });

    it('keeps time-only lines as today when no temporal context exists', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const board = {
            columns: [
                {
                    title: 'Schedule',
                    cards: [
                        {
                            content: 'Daily Work\n- [ ] @08:00-10:00 : Setup'
                        }
                    ]
                }
            ]
        };

        const result = DashboardScanner.scanBoard(
            board as any,
            'file:///tmp/board.md',
            'Board',
            1
        );

        const timeItem = result.upcomingItems.find(item => item.temporalTag === '@08:00-10:00');
        expect(timeItem).toBeDefined();

        const itemDate = new Date(timeItem!.date!);
        itemDate.setHours(0, 0, 0, 0);
        expect(itemDate.getTime()).toBe(today.getTime());
    });

    it('parses week-with-year and keeps attached time slot', () => {
        const year = new Date().getFullYear() + 1;
        const week = 25;
        const expectedDate = getDateOfISOWeek(week, year);

        const item = scanSingleTemporalLine(`- [ ] @${year}-kw${week} @08:00-10:00`);
        expect(item).toBeDefined();
        expect(item.temporalTag).toBe(`@${year}-kw${week}`);
        expect(item.timeSlot).toBe('@08:00-10:00');
        expect(item.week).toBe(week);
        expect(item.year).toBe(year);

        const itemDate = new Date(item.date!);
        itemDate.setHours(0, 0, 0, 0);
        expect(itemDate.getTime()).toBe(expectedDate.getTime());
    });

    it('parses dot-notation week tags with year', () => {
        const year = new Date().getFullYear() + 1;
        const week = 26;
        const expectedDate = getDateOfISOWeek(week, year);

        const item = scanSingleTemporalLine(`- [ ] @${year}.w${week}`);
        expect(item).toBeDefined();
        expect(item.temporalTag).toBe(`@${year}.w${week}`);
        expect(item.week).toBe(week);
        expect(item.year).toBe(year);

        const itemDate = new Date(item.date!);
        itemDate.setHours(0, 0, 0, 0);
        expect(itemDate.getTime()).toBe(expectedDate.getTime());
    });

    it('parses ISO date tags and day-first date tags', () => {
        const year = new Date().getFullYear() + 1;

        const isoItem = scanSingleTemporalLine(`- [ ] @${year}-03-27`);
        expect(isoItem).toBeDefined();
        expect(isoItem.temporalTag).toBe(`@${year}-03-27`);
        const isoDate = new Date(isoItem.date!);
        isoDate.setHours(0, 0, 0, 0);
        expect(isoDate.getFullYear()).toBe(year);
        expect(isoDate.getMonth()).toBe(2);
        expect(isoDate.getDate()).toBe(27);

        const dayFirstItem = scanSingleTemporalLine(`- [ ] @27.03.${year}`);
        expect(dayFirstItem).toBeDefined();
        expect(dayFirstItem.temporalTag).toBe(`@27.03.${year}`);
        const dayFirstDate = new Date(dayFirstItem.date!);
        dayFirstDate.setHours(0, 0, 0, 0);
        expect(dayFirstDate.getFullYear()).toBe(year);
        expect(dayFirstDate.getMonth()).toBe(2);
        expect(dayFirstDate.getDate()).toBe(27);
    });

    it('parses time formats and keeps them scoped to today when no date context exists', () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const rangeNoColon = scanSingleTemporalLine('- [ ] @1200-1400');
        expect(rangeNoColon).toBeDefined();
        expect(rangeNoColon.temporalTag).toBe('@1200-1400');
        expect(rangeNoColon.timeSlot).toBe('@1200-1400');
        const rangeDate = new Date(rangeNoColon.date!);
        rangeDate.setHours(0, 0, 0, 0);
        expect(rangeDate.getTime()).toBe(today.getTime());

        const fourDigitTime = scanSingleTemporalLine('- [ ] @1230');
        expect(fourDigitTime).toBeDefined();
        expect(fourDigitTime.temporalTag).toBe('@1230');
        expect(fourDigitTime.timeSlot).toBe('@1230');
        const fourDigitDate = new Date(fourDigitTime.date!);
        fourDigitDate.setHours(0, 0, 0, 0);
        expect(fourDigitDate.getTime()).toBe(today.getTime());
    });

    it('does not treat plain years as time tags', () => {
        const year = new Date().getFullYear() + 1;
        const item = scanSingleTemporalLine(`- [ ] @Y${year}`);
        expect(item).toBeDefined();
        expect(item.temporalTag).toBe(`@Y${year}`);
        expect(item.timeSlot).toBeUndefined();

        const itemDate = new Date(item.date!);
        itemDate.setHours(0, 0, 0, 0);
        expect(itemDate.getFullYear()).toBe(year);
        expect(itemDate.getMonth()).toBe(0);
        expect(itemDate.getDate()).toBe(1);
    });
});

// ─── 4-Level Temporal Tag Cascading Tests ────────────────────────────

import { resolveTaskTemporals } from '@ludos/shared';

function getWeekdayOfISOWeek(week: number, year: number, weekday: number): Date {
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
    const result = new Date(monday);
    result.setDate(monday.getDate() + daysFromMonday);
    result.setHours(0, 0, 0, 0);
    return result;
}

describe('4-Level Temporal Tag Cascading', () => {
    it('column @jan @mon + card @kw2 → month+weekday+week cross-product', () => {
        const results = resolveTaskTemporals('Task @kw2', '@jan @mon');

        expect(results.length).toBeGreaterThanOrEqual(1);
        const r = results[0];
        expect(r.temporal.month).toBe(1);    // January from column
        expect(r.temporal.weekday).toBe(1);  // Monday from column
        expect(r.temporal.week).toBe(2);     // Week 2 from card
    });

    it('column @jan @mon + card line @tue → Tuesday overrides Monday', () => {
        const results = resolveTaskTemporals(
            'Task\n- [ ] Meeting @tue',
            '@jan @mon'
        );

        const meetingResult = results.find(r => r.temporal.tag === '@tue');
        expect(meetingResult).toBeDefined();
        expect(meetingResult!.temporal.month).toBe(1);    // January inherited from column
        expect(meetingResult!.temporal.weekday).toBe(2);  // Tuesday overrides Monday
    });

    it('sub-item inherits parent line tokens, overrides time only', () => {
        const year = new Date().getFullYear() + 1;
        const week = 10;
        const results = resolveTaskTemporals(
            [
                `Sprint @${year}-kw${week} @mon`,
                '  - [ ] @09:00-10:00 Standup'
            ].join('\n'),
            'Schedule'
        );

        const subItem = results.find(r => r.temporal.tag === '@09:00-10:00');
        expect(subItem).toBeDefined();
        expect(subItem!.effectiveWeek).toBe(week);
        expect(subItem!.effectiveWeekday).toBe(1);  // Monday from parent
        expect(subItem!.temporal.timeSlot).toBe('@09:00-10:00');

        // Verify date = Monday of that week
        const expectedDate = getWeekdayOfISOWeek(week, year, 1);
        const itemDate = new Date(subItem!.effectiveDate);
        itemDate.setHours(0, 0, 0, 0);
        expect(itemDate.getTime()).toBe(expectedDate.getTime());
    });

    it('sub-item does NOT pollute sibling context', () => {
        const year = new Date().getFullYear() + 1;
        const week = 10;
        const results = resolveTaskTemporals(
            [
                `Sprint @${year}-kw${week} @mon`,
                '  - [ ] @tue Retro',       // sub-item overrides to Tuesday
                '- [ ] @09:00-10:00 Review'  // top-level: should still inherit Monday
            ].join('\n'),
            'Schedule'
        );

        const retroResult = results.find(r => r.temporal.tag === '@tue');
        expect(retroResult).toBeDefined();
        expect(retroResult!.effectiveWeekday).toBe(2);  // Tuesday (sub-item override)

        const reviewResult = results.find(r => r.temporal.tag === '@09:00-10:00');
        expect(reviewResult).toBeDefined();
        expect(reviewResult!.effectiveWeek).toBe(week);
        expect(reviewResult!.effectiveWeekday).toBe(1);  // Monday from context, not sub-item's Tuesday
    });

    it('column cascades to time-only line when card title has no temporal', () => {
        const results = resolveTaskTemporals(
            'Plain Card Title\n- [ ] @09:00-10:00 Meeting',
            '@jan @mon'
        );

        const meetingResult = results.find(r => r.temporal.tag === '@09:00-10:00');
        expect(meetingResult).toBeDefined();
        expect(meetingResult!.temporal.month).toBe(1);    // January from column
        expect(meetingResult!.temporal.weekday).toBe(1);  // Monday from column
        expect(meetingResult!.temporal.timeSlot).toBe('@09:00-10:00');
    });
});
