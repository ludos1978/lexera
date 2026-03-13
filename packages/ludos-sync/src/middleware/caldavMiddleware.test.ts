import type { IcalTask } from '../mappers/IcalMapper';
import { __test } from './caldavMiddleware';

describe('caldavMiddleware helpers', () => {
  it('parses requested PROPFIND properties from object bodies', () => {
    const props = __test.parseRequestedProps({
      'D:propfind': {
        'D:prop': {
          'D:current-user-principal': '',
          'C:calendar-home-set': '',
        },
      },
    });

    expect(props).not.toBeNull();
    expect(Array.from(props || [])).toEqual([
      'D:current-user-principal',
      'C:calendar-home-set',
    ]);
  });

  it('extracts Apple PROPPATCH property names without wrapper tags', () => {
    const propNames = __test.extractProppatchPropNames(
      "<?xml version='1.0'?><D:propertyupdate xmlns:D='DAV:' xmlns:A='http://apple.com/ns/ical/'><D:set><D:prop><A:calendar-color>#FF0000FF</A:calendar-color><A:calendar-order>1</A:calendar-order></D:prop></D:set></D:propertyupdate>"
    );

    expect(propNames).toEqual(['A:calendar-color', 'A:calendar-order']);
  });

  it('extracts calendar-multiget UIDs from XML strings', () => {
    const report = __test.parseReportBody(
      "<?xml version='1.0'?><C:calendar-multiget xmlns:D='DAV:' xmlns:C='urn:ietf:params:xml:ns:caldav'><D:prop><D:getetag/><C:calendar-data/></D:prop><D:href>/caldav/calendars/apple-smoke/test-uid.ics</D:href></C:calendar-multiget>",
      '/caldav',
      'apple-smoke'
    );

    expect(report.type).toBe('multiget');
    expect(Array.from(report.requestedUids || [])).toEqual(['test-uid']);
  });

  it('extracts calendar-multiget UIDs from object bodies', () => {
    const report = __test.parseReportBody(
      {
        'C:calendar-multiget': {
          'D:prop': {
            'D:getetag': '',
            'C:calendar-data': '',
          },
          'D:href': '/caldav/calendars/apple-smoke/object-uid.ics',
        },
      },
      '/caldav',
      'apple-smoke'
    );

    expect(report.type).toBe('multiget');
    expect(Array.from(report.requestedUids || [])).toEqual(['object-uid']);
  });

  it('filters tasks down to the requested calendar-multiget UID', () => {
    const tasks: IcalTask[] = [
      {
        uid: 'object-uid',
        type: 'VEVENT',
        summary: 'Wanted',
        dtstart: '20260305',
        dtstamp: '20260301T120000Z',
        status: 'CONFIRMED',
        categories: [],
        columnTitle: 'Open Work',
      },
      {
        uid: 'other-uid',
        type: 'VEVENT',
        summary: 'Other',
        dtstart: '20260306',
        dtstamp: '20260301T120000Z',
        status: 'CONFIRMED',
        categories: [],
        columnTitle: 'Open Work',
      },
    ];

    const filtered = __test.applyReportFilter(
      __test.parseReportBody(
        {
          'C:calendar-multiget': {
            'D:href': '/caldav/calendars/apple-smoke/object-uid.ics',
          },
        },
        '/caldav',
        'apple-smoke'
      ),
      tasks
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].uid).toBe('object-uid');
  });
});
