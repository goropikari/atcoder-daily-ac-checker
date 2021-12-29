interface MotivatedUser {
  slackName: string;
  submissions: AcSubmission[];
  aojSubmissions: AojSubmission[];
}

interface MoreMotivatedUser {
  slackName: string;
  targetAcceptedCount: number;
}

interface AcSubmission {
  id: number;
  problem_id: string;
  contest_id: string;
  title: string;
}

interface Submission {
  id: number;
  epoch_second: number;
  problem_id: string;
  contest_id: string;
  user_id: string;
  language: string;
  point: number;
  length: number;
  result: string;
  execution_time: number;
}

interface AojSubmission {
  userId: string;
  judgeId: number;
  problemId: string;
  title: string;
  language: string;
}

interface AojRawSubmission {
  judgeId: number;
  userId: string;
  problemId: string;
  language: string;
  version: string;
  submissionDate: number;
  judgeDate: number;
  cpuTime: number;
  memory: number;
  codeSize: number;
  server: number;
  policy: string;
  rating: number;
  review: number;
}

interface Problem {
  id: string;
  contest_id: string;
  title: string;
}

function getAtcoderProblems(): Problem[] {
  const url = "https://kenkoooo.com/atcoder/resources/problems.json";
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    contentType: "application/json",
    muteHttpExceptions: true,
  });

  return JSON.parse(response.getContentText());
}

function getFormattedDateString(date: Date): string {
  return Utilities.formatDate(date, "JST", "yyyy-MM-dd");
}

/**
 * 前日の日付を取得
 */
function getTargetDate(): Date {
  const today = new Date();

  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
}

function getTargetDateString(): string {
  return getFormattedDateString(getTargetDate());
}

function getFromEpochSecond(): number {
  return getTargetDate().getTime() / 1000;
}

function postMessage(messages: string | string[]): void {
  if (typeof messages === "string") {
    messages = [messages];
  }

  const slackBotToken =  PropertiesService.getScriptProperties().getProperty("SLACK_BOT_TOKEN");
  const channelID = PropertiesService.getScriptProperties().getProperty("CHANNEL_ID");
  UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", {
    method: "post",
    payload: {
      token: slackBotToken,
      channel: channelID,
      blocks: JSON.stringify(messages.map((message) => {
        return {
          type: "section",
          text: {
            type: "mrkdwn",
            text: message,
          },
        };
      })),
    },
  });

  Utilities.sleep(500);
}

function getAOJTitle(problemId: string): string {
  const url = `https://judgeapi.u-aizu.ac.jp/resources/descriptions/ja/${problemId}`;
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    contentType: "application/json",
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) return "";

  const html: string = JSON.parse(response.getContentText()).html.toLowerCase();
  const regex = new RegExp("<h1>(<.*>)?(.*?)</h1>", "im");
  const m = html.match(regex);

  return m[m.length - 1];
}

function getMotivatedUsers(atcoderIds: string[], aojIds: string[], slackNames: string[]): MotivatedUser[] {
  const targetDateString = getTargetDateString();
  const fromEpochSecond = getFromEpochSecond();
  const atcoderProblems = getAtcoderProblems();
  const result: MotivatedUser[] = [];

  atcoderIds.forEach((atcoderId, idx) => {
    if (atcoderId === "") return;

    const url = `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${atcoderId}&from_second=${fromEpochSecond}`;
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      contentType: "application/json",
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) return;

    let acSubmissions: AcSubmission[] = [];
    JSON.parse(response.getContentText()).forEach((submission: Submission) => {
      const submissionDateString = getFormattedDateString(new Date(submission.epoch_second * 1000));

      if (submissionDateString !== targetDateString || submission.result !== "AC") return;

      // 同じ問題の提出なら最新のやつを選ぶ
      let updated = false;
      acSubmissions = acSubmissions.map((acSubmission) => {
        if (acSubmission.problem_id === submission.problem_id) {
          acSubmission.id = Math.max(acSubmission.id, submission.id);
          updated = true;
        }

        return acSubmission;
      });

      if (!updated) {
        const problem = atcoderProblems.filter((problem: Problem) => {
          return problem.id === submission.problem_id;
        })[0];

        acSubmissions.push({
          id: submission.id,
          problem_id: submission.problem_id,
          contest_id: submission.contest_id,
          title: problem.title,
        });
      }
    });

    if (acSubmissions.length) {
      acSubmissions.sort((a, b) => {
        if (a.title < b.title) return -1;
        if (a.title > b.title) return 1;
        return 0;
      });

      result.push({
        slackName: slackNames[idx],
        submissions: acSubmissions,
        aojSubmissions: [],
      });
    }
  });

  aojIds.forEach((aojId, idx) => {
    if (aojId === "") return;

    const url = `https://judgeapi.u-aizu.ac.jp/solutions/users/${aojId}`;
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      contentType: "application/json",
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) return;

    let aojSubmissions: AojSubmission[] = [];
    JSON.parse(response.getContentText()).forEach((submission: AojRawSubmission) => {
      const submissionDateString = getFormattedDateString(new Date(submission.submissionDate));

      if (submissionDateString !== targetDateString) return;

      let updated = false;
      aojSubmissions = aojSubmissions.map((aojSubmission) => {
        if (aojSubmission.problemId === submission.problemId) {
          aojSubmission.judgeId = Math.max(aojSubmission.judgeId, submission.judgeId);
          updated = true;
        }

        return aojSubmission;
      });

      if (!updated) {
        aojSubmissions.push({
          userId: submission.userId,
          judgeId: submission.judgeId,
          problemId: submission.problemId,
          title: getAOJTitle(submission.problemId),
          language: submission.language,
        });
      }
    });

    if (aojSubmissions.length) {
      aojSubmissions.sort((a, b) => {
        if (a.problemId < b.problemId) return -1;
        if (a.problemId > b.problemId) return 1;
        return 0;
      });

      let updated = false;
      result.forEach((resu) => {
        if (resu.slackName == slackNames[idx]) {
          resu.aojSubmissions = aojSubmissions;
          updated = true;
        }
      });

      if (!updated) {
        result.push({
          slackName: slackNames[idx],
          submissions: [],
          aojSubmissions: aojSubmissions,
        });
      }
    }
  });

  result.sort((a, b) => {
    if (a.submissions.length === b.submissions.length) {
      if (a.slackName < b.slackName) return -1;
      if (a.slackName > b.slackName) return 1;
      return 0;
    }

    return b.submissions.length - a.submissions.length;
  });

  return result;
}

function getMoreMotivatedUsers(atcoderIds: string[], slackNames: string[]): MoreMotivatedUser[] {
  const checkMark = "✅";

  const sheetId = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName("AC記録用");
  const data = sheet.getSheetValues(1, 1, sheet.getLastRow(), sheet.getLastColumn());
  const masterData = data.shift();

  const result: MoreMotivatedUser[] = [];
  atcoderIds.forEach((atcoderId, idx) => {
    const url = `https://kenkoooo.com/atcoder/atcoder-api/v2/user_info?user=${atcoderId}`;
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      contentType: "application/json",
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) return;

    const currentAcceptedCount: number = JSON.parse(response.getContentText()).accepted_count;

    let found = false;
    let updatedMaxTargetAcceptedCount = -1;

    for (let i = 0; i < data.length; i++) {
      if (atcoderId !== data[i][0]) continue;

      for (let j = 1; j < masterData.length; j++) {
        const targetAcceptedCount: number = masterData[j];
        if (data[i][j] === "" && targetAcceptedCount <= currentAcceptedCount) {
          updatedMaxTargetAcceptedCount = Math.max(updatedMaxTargetAcceptedCount, targetAcceptedCount);
          data[i][j] = checkMark;
        }
      }

      found = true;
      break;
    }

    if (!found) {
      const d = [atcoderId];
      for (let j = 1; j < masterData.length; j++) {
        const targetAcceptedCount: number = masterData[j];
        d.push(targetAcceptedCount <= currentAcceptedCount ? checkMark : "");
      }
      data.push(d);
    }

    if (updatedMaxTargetAcceptedCount !== -1) {
      result.push({
        slackName: slackNames[idx],
        targetAcceptedCount: updatedMaxTargetAcceptedCount,
      });
    }
  });

  sheet.getRange(2, 1, data.length, sheet.getLastColumn()).setValues(data);

  result.sort((a, b) => {
    if (a.targetAcceptedCount === b.targetAcceptedCount) {
      if (a.slackName < b.slackName) return -1;
      if (a.slackName > b.slackName) return 1;
      return 0;
    }

    return b.targetAcceptedCount - a.targetAcceptedCount;
  });

  return result;
}

function main(): void {
  const targetDateString = getTargetDateString();

  const sheetId = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName("管理表");
  // getSheetValues(startRow, startColumn, numRows, numColumns)
  const data = sheet.getSheetValues(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());

  const slackNames: string[] = data.map((row) => row[0].trim());
  const atcoderIds: string[] = data.map((row) => {
    if (row[1]) {
      return row[1].trim();
    }
    return "";
  });
  const aojIds: string[] = data.map((row) => {
    if (row[2]) {
      return row[2].trim();
    }
    return "";
  });

  const motivatedUsers: MotivatedUser[] = getMotivatedUsers(atcoderIds, aojIds, slackNames);
  const moreMotivatedUsers: MoreMotivatedUser[] = getMoreMotivatedUsers(atcoderIds, slackNames);

  if (motivatedUsers.length) {
    const messages = [];

    messages.push(
      `*${targetDateString}* にACした人を紹介するよ！（通知設定は<https://docs.google.com/spreadsheets/d/${sheetId}/|こちら>）`
    );

    motivatedUsers.forEach((motivatedUser: MotivatedUser) => {
      if (motivatedUser.submissions.length === 0 && motivatedUser.aojSubmissions.length === 0) return;

      const tmpMessages = [];
      tmpMessages.push(`*${motivatedUser.slackName}*`);
      tmpMessages.push(
        ...motivatedUser.submissions.map((submission) => {
          return `- <https://atcoder.jp/contests/${submission.contest_id}/tasks/${submission.problem_id}|${submission.title}> | <https://atcoder.jp/contests/${submission.contest_id}/submissions/${submission.id}|提出コード>`;
        })
      );

      tmpMessages.push(
        ...motivatedUser.aojSubmissions.map((submission) => {
          return `- <https://onlinejudge.u-aizu.ac.jp/problems/${submission.problemId}|${submission.problemId}: ${submission.title}> | <https://onlinejudge.u-aizu.ac.jp/status/users/${submission.userId}/submissions/1/${submission.problemId}/judge/${submission.judgeId}/${submission.language}|提出コード>`;
        })
      );

      messages.push(tmpMessages.join("\n"));
    });

    messages.push("やってる！最高！引き続きやっていきましょう:fire:");

    postMessage(messages);
  }

  if (moreMotivatedUsers.length) {
    const messages = [];

    messages.push("*今* 勢いのある人を紹介するよ！");

    messages.push(
      moreMotivatedUsers
        .map((moreMotivatedUser) => {
          return `*${moreMotivatedUser.slackName}* ㊗️ *${moreMotivatedUser.targetAcceptedCount}* AC達成 👏`;
        })
        .join("\n")
    );

    messages.push("めっちゃやってる！やばいね？最＆高！");

    postMessage(messages);
  }
}

function hello(): void {
  postMessage("こんにちは！僕の名前はAC褒め太郎。競プロを楽しんでる人を応援するよ！");
}

function p(v: any): void {
  Logger.log(v);
}
